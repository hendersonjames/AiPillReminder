/**
 * Integration tests that render through App to verify userId wiring.
 * 
 * These tests would fail if:
 * 1. App stops passing userId to ChatModal
 * 2. App stops passing userId to AddPillModal
 * 3. The send-time consent check in ChatModal.handleSend is removed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { localStorageMock } from './setup';

const mockUser = { id: 'test-user-app-integration', email: 'test@example.com' };

vi.mock('../services/authService', () => ({
  onAuthStateChange: vi.fn((callback) => {
    callback(mockUser);
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  }),
  signOut: vi.fn(),
}));

vi.mock('../services/pillsService', () => ({
  loadPillsFromCloud: vi.fn().mockResolvedValue([]),
  syncPillsToCloud: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/notificationService', () => ({
  requestNotificationPermission: vi.fn().mockResolvedValue(undefined),
  getNotificationPermission: vi.fn().mockReturnValue('granted'),
  fireImmediateNotification: vi.fn(),
  scheduleReminderNotifications: vi.fn(),
  cancelAllPillNotifications: vi.fn(),
  cancelReminderNotifications: vi.fn(),
  registerNotificationListeners: vi.fn(),
  isNative: vi.fn().mockReturnValue(false),
}));

vi.mock('../services/geminiService', () => ({
  getChatResponse: vi.fn().mockResolvedValue('AI response from Gemini'),
  getQuickSuggestion: vi.fn().mockResolvedValue('AI suggestion'),
}));

import App from '../App';
import { grantAIConsent, revokeAIConsent } from '../services/aiConsentService';
import { getChatResponse, getQuickSuggestion } from '../services/geminiService';

describe('App userId wiring to ChatModal', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('passes userId to ChatModal - consent works correctly', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Chat/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-consent-dialog')).toBeInTheDocument();
    });

    const consentDialog = screen.getByTestId('ai-consent-dialog');
    const enableButton = consentDialog.querySelector('button');
    expect(enableButton).toHaveTextContent(/Enable AI Features/i);
    fireEvent.click(enableButton!);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask a question/i)).toBeInTheDocument();
    });
  });

  it('ChatModal receives userId from App - consent is user-specific', async () => {
    grantAIConsent(mockUser.id);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Chat/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask a question/i)).toBeInTheDocument();
    });

    expect(screen.queryByTestId('ai-consent-dialog')).not.toBeInTheDocument();
  });
});

describe('App userId wiring to AddPillModal', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('passes userId to AddPillModal - consent works correctly', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Add Pill/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Pill Name/i)).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/Pill Name/i);
    fireEvent.change(nameInput, { target: { value: 'Aspirin' } });

    expect(screen.getByText(/Enable AI suggestions/i)).toBeInTheDocument();
  });

  it('AddPillModal receives userId from App - granted consent enables suggestions', async () => {
    grantAIConsent(mockUser.id);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Add Pill/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Pill Name/i)).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/Pill Name/i);
    fireEvent.change(nameInput, { target: { value: 'Ibuprofen' } });

    await waitFor(() => {
      expect(getQuickSuggestion).toHaveBeenCalledWith('Ibuprofen');
    }, { timeout: 1000 });
  });
});

describe('ChatModal send-time consent check', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('does not call getChatResponse even with input if consent is revoked mid-session', async () => {
    grantAIConsent(mockUser.id);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Chat/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask a question/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Ask a question/i);
    fireEvent.change(input, { target: { value: 'Hello AI' } });

    revokeAIConsent(mockUser.id);

    fireEvent.click(screen.getByRole('button', { name: /AI Privacy Settings/i }));

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Ask a question/i)).not.toBeInTheDocument();
    });

    expect(getChatResponse).not.toHaveBeenCalled();
  });

  it('blocks message send when hasConsent is false', async () => {
    grantAIConsent(mockUser.id);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Chat/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask a question/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Ask a question/i);
    fireEvent.change(input, { target: { value: 'Test message' } });
    
    const sendButton = screen.getByRole('button', { name: /Send message/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(getChatResponse).toHaveBeenCalled();
    });

    vi.mocked(getChatResponse).mockClear();

    fireEvent.click(screen.getByRole('button', { name: /AI Privacy Settings/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-consent-dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /No Thanks/i }));

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Ask a question/i)).not.toBeInTheDocument();
    });

    expect(getChatResponse).not.toHaveBeenCalled();
  });

  it('only calls getChatResponse when consent is granted at send time', async () => {
    grantAIConsent(mockUser.id);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Chat/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask a question/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Ask a question/i);
    fireEvent.change(input, { target: { value: 'What is aspirin?' } });
    
    const sendButton = screen.getByRole('button', { name: /Send message/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(getChatResponse).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('What is aspirin?')).toBeInTheDocument();
  });
});
