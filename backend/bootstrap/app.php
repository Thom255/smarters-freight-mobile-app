<?php

use App\Exceptions\DataStoreUnavailable;
use App\Http\Middleware\AllowPrivateNetworkAccess;
use App\Http\Middleware\AuthenticateApi;
use App\Http\Middleware\AuthorizeRole;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'auth.api' => AuthenticateApi::class,
            'auth.role' => AuthorizeRole::class,
        ]);

        // Prepended (not appended) so it wraps HandleCors — CORS returns the
        // preflight response early, and this adds Chrome's Private Network
        // Access header to it.
        $middleware->prepend(AllowPrivateNetworkAccess::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // Mobile contract: every auth/validation failure is
        // { ok:false, field, message } so the screens can show it inline.
        $exceptions->render(function (ValidationException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $field = array_key_first($e->errors()) ?? 'form';
            $message = $e->errors()[$field][0] ?? $e->getMessage();

            return response()->json([
                'ok' => false,
                'field' => $field,
                'message' => $message,
            ], 422);
        });

        // Unknown API paths keep the same envelope as everything else, so the
        // app can show `message` instead of a bare { message:"Not Found" }.
        $exceptions->render(function (NotFoundHttpException|MethodNotAllowedHttpException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $message = $e instanceof MethodNotAllowedHttpException
                ? 'That method is not allowed on this endpoint'
                : 'Endpoint not found';

            return response()->json([
                'ok' => false,
                'field' => 'form',
                'message' => $message,
            ], $e->getStatusCode());
        });

        // Supabase/PostgREST could not answer. The detail (which call, which
        // upstream status) stays in the log; the client only gets a friendly
        // retryable message plus the real condition — 503 when the data store
        // is unreachable, 502 when it returned a bad response, 500 when the
        // schema or keys are wrong. The app previously saw a flat 500 for all
        // three, so it could not tell "retry in a minute" from "this is broken".
        // Registered BEFORE the catch-all below so it wins the dispatch.
        $exceptions->render(function (DataStoreUnavailable $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $status = $e->status();

            return response()->json([
                'ok' => false,
                'field' => 'form',
                'message' => $status === 500
                    ? 'Something went wrong on our side. Please try again.'
                    : 'The service is temporarily unavailable. Please try again in a moment.',
            ], $status);
        });

        // Anything unexpected on the API collapses to the same contract
        // instead of a debug page: APP_DEBUG=true is fine for local dev, but
        // the mobile app must never receive stack traces or file paths. The
        // exception is still reported to the log by HandleExceptions before
        // it reaches this callback, so nothing is swallowed.
        $exceptions->render(function (Throwable $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            // Let framework exceptions keep their own status codes and bodies
            // (404 route, 405, 429 throttle, validation above, response passthrough).
            if (
                $e instanceof HttpExceptionInterface
                || $e instanceof ValidationException
                || $e instanceof HttpResponseException
                || $e instanceof AuthenticationException
            ) {
                return null;
            }

            return response()->json([
                'ok' => false,
                'field' => 'form',
                'message' => 'Something went wrong on our side. Please try again.',
            ], 500);
        });
    })->create();
