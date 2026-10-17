<?php

namespace App\Exceptions;

use RuntimeException;
use Throwable;

/**
 * The data store (Supabase/PostgREST) could not answer the request —
 * connection refused, timed out, 5xx upstream, or the schema is missing.
 *
 * SupabaseClient raises this instead of a bare RuntimeException so the API
 * can report the real upstream condition (503/502) instead of collapsing
 * every outage into a generic 500. The message never reaches the client:
 * bootstrap/app.php renders a friendly, internal-free body, and the log
 * keeps the detail for operators.
 *
 * getCode() carries the HTTP status, matching the previous convention.
 */
class DataStoreUnavailable extends RuntimeException
{
    public function __construct(string $message, int $status = 503, ?Throwable $previous = null)
    {
        parent::__construct($message, $status, $previous);
    }

    /** HTTP status this failure should be reported as. */
    public function status(): int
    {
        $code = (int) $this->getCode();

        return ($code >= 400 && $code <= 599) ? $code : 503;
    }
}
