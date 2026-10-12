/**
 * Mutation-resistant tests for AI consent gates.
 * 
 * These tests verify that consent gating is properly implemented and would fail
 * if the consent checks or userId passing were removed from the components.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { localStorageMock } from './setup';

vi.mock('../services/geminiService', () => ({
  getChatResponse: vi.fn().mockResolvedValue('AI response'),
  getQuickSuggestion: vi.fn().mockResolvedValue('AI suggestion'),
}));

import ChatModal from '../components/ChatModal';
import AddPillModal from '../components/AddPillModal';
import { grantAIConsent, declineAIConsent } from '../services/aiConsentService';
import { getChatResponse, getQuickSuggestion } from '../services/geminiService';

describe('ChatModal consent gate', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('does not show chat input when consent is not granted', async () => {
    const userId = 'test-user-123';
    render(<ChatModal onClose={vi.fn()} userId={userId} />);

    expect(screen.queryByPlaceholderText(/Ask a question/i)).not.toBeInTheDocument();
    expect(getChatResponse).not.toHaveBeenCalled();
  });

  it('requires userId prop - component must receive it to function', () => {
    const userId = 'test-user-456';
    grantAIConsent(userId);
    
    render(<ChatModal onClose={vi.fn()} userId={userId} />);
    
    const input = screen.getByPlaceholderText(/Ask a question/i);
    expect(input).toBeInTheDocument();
  });

  it('shows consent dialog when userId is provided and consent is unknown', () => {
    const userId = 'new-user-789';
    render(<ChatModal onClose={vi.fn()} userId={userId} />);
    
    expect(screen.getByTestId('ai-consent-dialog')).toBeInTheDocument();
  });

  it('blocks chat input when consent is declined', () => {
    const userId = 'declined-user';
    declineAIConsent(userId);
    
    render(<ChatModal onClose={vi.fn()} userId={userId} />);
    
    expect(screen.queryByPlaceholderText(/Ask a question/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Enable AI Features/i)).toBeInTheDocument();
  });

  it('allows chat when consent is granted', async () => {
    const userId = 'granted-user';
    grantAIConsent(userId);
    
    render(<ChatModal onClose={vi.fn()} userId={userId} />);
    
    const input = screen.getByPlaceholderText(/Ask a question/i);
    expect(input).toBeInTheDocument();
    expect(input).not.toBeDisabled();
  });

  it('shows AI Privacy Settings link when consent is granted', () => {
    const userId = 'granted-user-2';
    grantAIConsent(userId);
    
    render(<ChatModal onClose={vi.fn()} userId={userId} />);
    
    expect(screen.getByText(/AI Privacy Settings/i)).toBeInTheDocument();
  });
});

describe('AddPillModal consent gate', () => {
  const mockSavePill = vi.fn();
  
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('does not call getQuickSuggestion when consent is not granted', async () => {
    const userId = 'test-user-123';
    render(
      <AddPillModal 
        onClose={vi.fn()} 
        onSavePill={mockSavePill} 
        userId={userId} 
      />
    );

    const nameInput = screen.getByLabelText(/Pill Name/i);
    fireEvent.change(nameInput, { target: { value: 'Aspirin' } });
    
    await new Promise(resolve => setTimeout(resolve, 600));
    
    expect(getQuickSuggestion).not.toHaveBeenCalled();
  });

  it('requires userId prop - component must receive it for consent to work', () => {
    const userId = 'test-user-456';
    grantAIConsent(userId);
    
    render(
      <AddPillModal 
        onClose={vi.fn()} 
        onSavePill={mockSavePill} 
        userId={userId} 
      />
    );
    
    expect(screen.getByLabelText(/Pill Name/i)).toBeInTheDocument();
  });

  it('shows Enable AI suggestions link when consent not granted and name entered', () => {
    const userId = 'no-consent-user';
    
    render(
      <AddPillModal 
        onClose={vi.fn()} 
        onSavePill={mockSavePill} 
        userId={userId} 
      />
    );

    const nameInput = screen.getByLabelText(/Pill Name/i);
    fireEvent.change(nameInput, { target: { value: 'Aspirin' } });
    
    expect(screen.getByText(/Enable AI suggestions/i)).toBeInTheDocument();
  });

  it('calls getQuickSuggestion when consent is granted', async () => {
    const userId = 'granted-user';
    grantAIConsent(userId);
    
    render(
      <AddPillModal 
        onClose={vi.fn()} 
        onSavePill={mockSavePill} 
        userId={userId} 
      />
    );

    const nameInput = screen.getByLabelText(/Pill Name/i);
    fireEvent.change(nameInput, { target: { value: 'Aspirin' } });
    
    await waitFor(() => {
      expect(getQuickSuggestion).toHaveBeenCalledWith('Aspirin');
    }, { timeout: 1000 });
  });

  it('shows AI Privacy Settings link when consent is granted', () => {
    const userId = 'granted-user-2';
    grantAIConsent(userId);
    
    render(
      <AddPillModal 
        onClose={vi.fn()} 
        onSavePill={mockSavePill} 
        userId={userId} 
      />
    );
    
    expect(screen.getByText(/AI Privacy Settings/i)).toBeInTheDocument();
  });
});

describe('AIConsentDialog portal rendering', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('renders consent dialog via portal to document.body', () => {
    const userId = 'portal-test-user';
    render(<ChatModal onClose={vi.fn()} userId={userId} />);
    
    const dialog = screen.getByTestId('ai-consent-dialog-overlay');
    expect(dialog.parentElement).toBe(document.body);
  });

  it('consent dialog has higher z-index than modals (z-50 = 50)', () => {
    const userId = 'z-index-test-user';
    render(<ChatModal onClose={vi.fn()} userId={userId} />);
    
    const overlay = screen.getByTestId('ai-consent-dialog-overlay');
    const computedStyle = window.getComputedStyle(overlay);
    const zIndex = parseInt(computedStyle.zIndex, 10);
    
    expect(zIndex).toBeGreaterThan(50);
  });

  it('consent dialog is last child of body (renders after modal content)', () => {
    const userId = 'render-order-test';
    render(<ChatModal onClose={vi.fn()} userId={userId} />);
    
    const dialog = screen.getByTestId('ai-consent-dialog-overlay');
    const bodyChildren = Array.from(document.body.children);
    const dialogIndex = bodyChildren.indexOf(dialog);
    
    expect(dialogIndex).toBe(bodyChildren.length - 1);
  });
});
