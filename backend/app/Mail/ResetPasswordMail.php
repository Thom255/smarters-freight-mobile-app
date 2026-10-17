<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Password-reset email. The reset link opens the mobile app directly (custom
 * scheme) and falls back to a web URL for desktop mail clients.
 */
class ResetPasswordMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $appUrl,
        public string $webUrl,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Reset your Smarters Freight password',
        );
    }

    public function content(): Content
    {
        return new Content(
            text: 'mail.reset-password',
            with: [
                'appUrl' => $this->appUrl,
                'webUrl' => $this->webUrl,
            ],
        );
    }
}
