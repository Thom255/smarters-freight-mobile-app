<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CargoController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\MatchController;
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

Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);

Route::middleware('auth.api')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);

    Route::get('/dashboard', DashboardController::class);

    Route::get('/shipments', [ShipmentController::class, 'index']);
    Route::post('/shipments', [ShipmentController::class, 'store']);
    Route::get('/shipments/{id}', [ShipmentController::class, 'show']);

    // Marketplace — trucks (SRS §14)
    Route::get('/trucks', [TruckController::class, 'index']);
    Route::post('/trucks', [TruckController::class, 'store']);
    Route::get('/trucks/{id}', [TruckController::class, 'show']);
    Route::patch('/trucks/{id}', [TruckController::class, 'update']);

    // Marketplace — cargo (SRS §16–§17)
    Route::get('/cargo', [CargoController::class, 'index']);
    Route::post('/cargo', [CargoController::class, 'store']);
    Route::get('/cargo/{id}', [CargoController::class, 'show']);
    Route::patch('/cargo/{id}', [CargoController::class, 'update']);

    // Marketplace — matching (SRS §18–§22)
    Route::get('/matches', [MatchController::class, 'index']);
    Route::get('/matches/cargo/{id}', [MatchController::class, 'forCargo']);
    Route::get('/matches/truck/{id}', [MatchController::class, 'forTruck']);
    Route::post('/matches/accept', [MatchController::class, 'accept']);
});
