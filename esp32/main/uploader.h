#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

// POST a JPEG frame to the Cloudflare Worker's /upload endpoint
// (UPLOAD_URL/UPLOAD_TOKEN from secrets.h), with Authorization: Bearer.
esp_err_t uploader_send_jpeg(const uint8_t *data, size_t len);
