#pragma once

#include "esp_camera.h"
#include "esp_err.h"

// Initialize the camera (AI-Thinker ESP32-CAM pinout, OV2640 sensor).
esp_err_t app_cam_init(void);

// Grab one JPEG frame. Returns NULL on failure. Caller MUST call
// app_cam_release() with the returned pointer once done reading fb->buf.
camera_fb_t *app_cam_grab(void);

// Release a frame buffer obtained from app_cam_grab().
void app_cam_release(camera_fb_t *fb);
