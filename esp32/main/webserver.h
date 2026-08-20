#pragma once

#include "esp_err.h"

// Start the HTTP server exposing GET /capture (single JPEG snapshot) and
// GET / (tiny health/info page).
esp_err_t webserver_start(void);
