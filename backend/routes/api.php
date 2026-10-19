<?php

use App\Http\Controllers\Api\AdminCommissionController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BookingController;
use App\Http\Controllers\Api\CargoController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\MarketplaceController;
use App\Http\Controllers\Api\MatchController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\Api\ShipmentController;
use App\Http\Controllers\Api\TruckController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Mobile API routes (prefix: /api)
|--------------------------------------------------------------------------
|
| Public:  register / login
| Private: everything else — resolved by the Bearer token issued at login.
|
*/

Route::post('/auth/register', [AuthController::class, 'register'])
    ->middleware('throttle:auth-register');
Route::post('/auth/login', [AuthController::class, 'login'])
    ->middleware('throttle:auth-login');
Route::post('/auth/forgot-password', [PasswordResetController::class, 'forgot'])
    ->middleware('throttle:auth-password');
Route::post('/auth/reset-password', [PasswordResetController::class, 'reset'])
    ->middleware('throttle:auth-password');

// `auth.api` resolves the bearer token; `throttle:api` caps the whole
// authenticated surface (the two public routes carry their own limits above).
// Role rules run after both so `auth_user` is present.
Route::middleware(['auth.api', 'throttle:api'])->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);

    Route::get('/dashboard', DashboardController::class);

    Route::get('/shipments', [ShipmentController::class, 'index']);
    Route::post('/shipments', [ShipmentController::class, 'store']);
    Route::get('/shipments/{id}', [ShipmentController::class, 'show']);
    Route::patch('/shipments/{id}', [ShipmentController::class, 'update']);

    // Marketplace — trucks (SRS §14). Fleet records belong to truck owners;
    // anyone signed in may browse them.
    Route::get('/trucks', [TruckController::class, 'index']);
    Route::post('/trucks', [TruckController::class, 'store'])
        ->middleware('auth.role:truck_owner');
    Route::get('/trucks/{id}', [TruckController::class, 'show']);
    Route::patch('/trucks/{id}', [TruckController::class, 'update'])
        ->middleware('auth.role:truck_owner');

    // Marketplace — cargo (SRS §16–§17). Loads belong to cargo owners.
    Route::get('/cargo', [CargoController::class, 'index']);
    Route::post('/cargo', [CargoController::class, 'store'])
        ->middleware('auth.role:cargo_owner');
    Route::get('/cargo/{id}', [CargoController::class, 'show']);
    Route::patch('/cargo/{id}', [CargoController::class, 'update'])
        ->middleware('auth.role:cargo_owner');

    // Marketplace — matching (SRS §18–§21). Read-only: scoring is stateless.
    Route::get('/matches', [MatchController::class, 'index']);
    Route::get('/matches/cargo/{id}', [MatchController::class, 'forCargo']);
    Route::get('/matches/truck/{id}', [MatchController::class, 'forTruck']);

    // Marketplace — open browse of every available truck / posted load.
    Route::get('/marketplace/trucks', [MarketplaceController::class, 'trucks']);
    Route::get('/marketplace/trucks/{id}', [MarketplaceController::class, 'truck']);
    Route::get('/marketplace/cargo', [MarketplaceController::class, 'cargo']);
    Route::get('/marketplace/cargo/{id}', [MarketplaceController::class, 'cargoShow']);

    // Bookings — request → accept/reject/cancel lifecycle (SRS §22).
    Route::get('/bookings', [BookingController::class, 'index']);
    Route::post('/bookings', [BookingController::class, 'store']);
    Route::post('/bookings/{id}/accept', [BookingController::class, 'accept']);
    Route::post('/bookings/{id}/reject', [BookingController::class, 'reject']);
    Route::post('/bookings/{id}/cancel', [BookingController::class, 'cancel']);

    // Admin — 8% platform commission ledger & revenue. Admin only: revenue
    // and settlement are never exposed to cargo/truck owners, and no other
    // route on this surface can touch the commissions table at all.
    Route::get('/admin/revenue', [AdminCommissionController::class, 'revenue'])
        ->middleware('auth.role:admin');
    Route::post('/admin/commissions/{id}/settle', [AdminCommissionController::class, 'settle'])
        ->middleware('auth.role:admin');
    Route::post('/admin/commissions/{id}/refund', [AdminCommissionController::class, 'refund'])
        ->middleware('auth.role:admin');
});
