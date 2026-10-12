import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AIConsentDialog from '../components/AIConsentDialog';

describe('AIConsentDialog', () => {
  it('renders the consent dialog with title', () => {
    render(<AIConsentDialog onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByText('Enable AI Features?')).toBeInTheDocument();
  });

  it('displays information about data sharing', () => {
    render(<AIConsentDialog onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByText('What data is shared:')).toBeInTheDocument();
    expect(screen.getByText(/Pill names you enter/)).toBeInTheDocument();
    expect(screen.getByText(/Messages you send in AI chat/)).toBeInTheDocument();
  });

  it('has a link to Google Privacy Policy', () => {
    render(<AIConsentDialog onAccept={vi.fn()} onDecline={vi.fn()} />);
    const link = screen.getByRole('link', { name: /Privacy Policy/i });
    expect(link).toHaveAttribute('href', 'https://policies.google.com/privacy');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('calls onAccept when Enable button is clicked', () => {
    const onAccept = vi.fn();
    render(<AIConsentDialog onAccept={onAccept} onDecline={vi.fn()} />);
    
    fireEvent.click(screen.getByRole('button', { name: /Enable AI Features/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('calls onDecline when No Thanks button is clicked', () => {
    const onDecline = vi.fn();
    render(<AIConsentDialog onAccept={vi.fn()} onDecline={onDecline} />);
    
    fireEvent.click(screen.getByRole('button', { name: /No Thanks/i }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('mentions ability to change choice later', () => {
    render(<AIConsentDialog onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByText(/You can change your choice anytime/)).toBeInTheDocument();
  });
});
