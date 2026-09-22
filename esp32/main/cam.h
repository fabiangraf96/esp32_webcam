#pragma once

#include "esp_camera.h"
#include "esp_err.h"

// Power the OV2640 up by releasing its PWDN pin, then wait for the sensor's
// internal regulators/oscillator to settle. Must be called before
// app_cam_init(), including on every wake from deep sleep (the PWDN level is
// latched across sleep by app_cam_power_off(), so the pad must be unlatched
// again here before the camera driver can take over the pin).
void app_cam_power_on(void);

// Drive PWDN high (sensor off) and latch the pad so the level survives deep
// sleep. Call app_cam_deinit() first: this only cuts sensor power, it does
// not stop the XCLK or free driver resources.
void app_cam_power_off(void);

// Initialize the camera (AI-Thinker ESP32-CAM pinout, OV2640 sensor).
esp_err_t app_cam_init(void);

// Stop the camera driver (halts XCLK/DMA and frees frame buffers). Any
// camera_fb_t obtained from app_cam_grab() is invalid afterwards.
void app_cam_deinit(void);

// Grab one JPEG frame. Returns NULL on failure. Caller MUST call
// app_cam_release() with the returned pointer once done reading fb->buf.
camera_fb_t *app_cam_grab(void);

// Grab and immediately discard `count` frames. After a cold power-up the
// OV2640's auto-exposure/auto-gain need a few frames to converge, so the
// first frame off the sensor is typically too dark or colour-shifted.
void app_cam_discard_frames(int count);

// Release a frame buffer obtained from app_cam_grab().
void app_cam_release(camera_fb_t *fb);
