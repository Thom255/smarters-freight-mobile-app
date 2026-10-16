<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="description" content="Smarters Freight REST API for the Expo mobile app.">
        <title>{{ config('app.name', 'Smarters Freight') }} — API</title>

        {{--
            Self-contained on purpose: no Vite manifest, no external stylesheets,
            no links to routes this app does not define (the previous welcome
            page linked to /login, /register and /dashboard, none of which
            exist here — /dashboard returned 404).
        --}}
        <style>
            :root {
                --bg: #f5f7fb;
                --surface: #ffffff;
                --text: #0b1220;
                --text-secondary: #5b6b82;
                --border: #dfe6f1;
                --primary: #2563eb;
                --brand-navy: #0b1f3a;
                --on-brand: #ffffff;
                --on-brand-muted: #afc4da;
                --success: #15803d;
            }

            * { box-sizing: border-box; }

            body {
                margin: 0;
                min-height: 100vh;
                background: var(--bg);
                color: var(--text);
                font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI",
                    Roboto, "Helvetica Neue", Arial, sans-serif;
                line-height: 1.5;
                display: flex;
                justify-content: center;
                padding: 48px 20px;
            }

            main { width: 100%; max-width: 760px; }

            header {
                background: var(--brand-navy);
                color: var(--on-brand);
                border-radius: 20px;
                padding: 28px 28px 24px;
                margin-bottom: 20px;
            }

            header h1 { margin: 0; font-size: 26px; letter-spacing: .04em; }
            header p { margin: 6px 0 0; color: var(--on-brand-muted); font-size: 14px; }

            .status {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                margin-top: 16px;
                background: rgba(255, 255, 255, .08);
                border: 1px solid rgba(255, 255, 255, .18);
                border-radius: 999px;
                padding: 6px 14px;
                font-size: 13px;
                color: var(--on-brand);
                text-decoration: none;
            }

            .dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #4ade80;
                display: inline-block;
            }

            section {
                background: var(--surface);
                border: 1px solid var(--border);
                border-radius: 16px;
                padding: 22px 24px;
                margin-bottom: 20px;
            }

            h2 { margin: 0 0 12px; font-size: 16px; }

            code, .method {
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 13px;
            }

            code {
                background: #eef3fb;
                border: 1px solid var(--border);
                border-radius: 6px;
                padding: 2px 6px;
            }

            table { width: 100%; border-collapse: collapse; font-size: 14px; }
            th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--border); }
            th { color: var(--text-secondary); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
            tr:last-child td { border-bottom: 0; }

            .method {
                display: inline-block;
                min-width: 54px;
                text-align: center;
                border-radius: 6px;
                padding: 2px 6px;
                font-weight: 600;
                font-size: 12px;
                background: #e8effe;
                color: var(--primary);
            }

            .method.post { background: #e7f7ee; color: var(--success); }
            .muted { color: var(--text-secondary); font-size: 13px; }
            footer { color: var(--text-secondary); font-size: 13px; text-align: center; }
        </style>
    </head>
    <body>
        <main>
            <header>
                <h1>{{ strtoupper(config('app.name', 'Smarters Freight')) }}</h1>
                <p>REST API powering the Expo mobile app — auth, dashboard and shipments.</p>
                <a class="status" href="/up">
                    <span class="dot"></span>
                    Health check: <code style="background:transparent;border:0;padding:0;color:inherit;">GET /up</code>
                </a>
            </header>

            <section>
                <h2>Base URL</h2>
                <p class="muted">
                    Send every request as JSON with <code>Accept: application/json</code>.
                    Authenticated endpoints require <code>Authorization: Bearer &lt;token&gt;</code>,
                    where the token comes from register or login.
                </p>
                <p style="margin-bottom:0;">
                    <code>{{ url('/api') }}</code>
                </p>
            </section>

            <section>
                <h2>Endpoints</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Method</th>
                            <th>Path</th>
                            <th>Auth</th>
                            <th>Purpose</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><span class="method post">POST</span></td>
                            <td><code>/api/auth/register</code></td>
                            <td class="muted">Public</td>
                            <td class="muted">Create an account, returns a token</td>
                        </tr>
                        <tr>
                            <td><span class="method post">POST</span></td>
                            <td><code>/api/auth/login</code></td>
                            <td class="muted">Public</td>
                            <td class="muted">Sign in with email or phone</td>
                        </tr>
                        <tr>
                            <td><span class="method">GET</span></td>
                            <td><code>/api/auth/me</code></td>
                            <td class="muted">Bearer</td>
                            <td class="muted">Current user profile</td>
                        </tr>
                        <tr>
                            <td><span class="method post">POST</span></td>
                            <td><code>/api/auth/logout</code></td>
                            <td class="muted">Bearer</td>
                            <td class="muted">Revoke the current token</td>
                        </tr>
                        <tr>
                            <td><span class="method">GET</span></td>
                            <td><code>/api/dashboard</code></td>
                            <td class="muted">Bearer</td>
                            <td class="muted">Stats, active shipment, recent activity</td>
                        </tr>
                        <tr>
                            <td><span class="method">GET</span></td>
                            <td><code>/api/shipments</code></td>
                            <td class="muted">Bearer</td>
                            <td class="muted">List the caller's shipments</td>
                        </tr>
                        <tr>
                            <td><span class="method post">POST</span></td>
                            <td><code>/api/shipments</code></td>
                            <td class="muted">Bearer</td>
                            <td class="muted">Create a shipment</td>
                        </tr>
                        <tr>
                            <td><span class="method">GET</span></td>
                            <td><code>/api/shipments/{id}</code></td>
                            <td class="muted">Bearer</td>
                            <td class="muted">Fetch one shipment</td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <section>
                <h2>Response contract</h2>
                <p class="muted" style="margin-top:0;">
                    Success: <code>{ "ok": true, ... }</code><br>
                    Failure: <code>{ "ok": false, "field": "...", "message": "..." }</code>
                    with HTTP <code>401</code> or <code>422</code>.
                </p>
                <p class="muted" style="margin-bottom:0;">
                    Point the app at this server with <code>EXPO_PUBLIC_API_URL</code>
                    in the project root <code>.env</code>.
                </p>
            </section>

            <footer>
                Laravel {{ app()->version() }} · PHP {{ PHP_VERSION }} · {{ now()->year }}
            </footer>
        </main>
    </body>
</html>
