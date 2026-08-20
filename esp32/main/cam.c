#include "cam.h"

#include "esp_log.h"

static const char *TAG = "cam";

// AI-Thinker ESP32-CAM pin map (OV2640).
#define CAM_PIN_PWDN 32
#define CAM_PIN_RESET -1 // not connected
#define CAM_PIN_XCLK 0
#define CAM_PIN_SIOD 26
#define CAM_PIN_SIOC 27

#define CAM_PIN_D7 35
#define CAM_PIN_D6 34
#define CAM_PIN_D5 39
#define CAM_PIN_D4 36
#define CAM_PIN_D3 21
#define CAM_PIN_D2 19
#define CAM_PIN_D1 18
#define CAM_PIN_D0 5
#define CAM_PIN_VSYNC 25
#define CAM_PIN_HREF 23
#define CAM_PIN_PCLK 22

esp_err_t app_cam_init(void)
{
    camera_config_t config = {
        .pin_pwdn = CAM_PIN_PWDN,
        .pin_reset = CAM_PIN_RESET,
        .pin_xclk = CAM_PIN_XCLK,
        .pin_sccb_sda = CAM_PIN_SIOD,
        .pin_sccb_scl = CAM_PIN_SIOC,

        .pin_d7 = CAM_PIN_D7,
        .pin_d6 = CAM_PIN_D6,
        .pin_d5 = CAM_PIN_D5,
        .pin_d4 = CAM_PIN_D4,
        .pin_d3 = CAM_PIN_D3,
        .pin_d2 = CAM_PIN_D2,
        .pin_d1 = CAM_PIN_D1,
        .pin_d0 = CAM_PIN_D0,
        .pin_vsync = CAM_PIN_VSYNC,
        .pin_href = CAM_PIN_HREF,
        .pin_pclk = CAM_PIN_PCLK,

        // 10 MHz is the safe/reliable clock for the AI-Thinker board's long
        // camera ribbon; 20 MHz can cause pixel noise on some units.
        .xclk_freq_hz = 10000000,
        .ledc_timer = LEDC_TIMER_0,
        .ledc_channel = LEDC_CHANNEL_0,

        .pixel_format = PIXFORMAT_JPEG,
        // Weather-cam use case: a still frame every few seconds, not a
        // stream, so we can afford the OV2640's maximum resolution and
        // near-best JPEG quality (0=best, 63=worst). Frame buffers live
        // in PSRAM (4 MB available), so the larger buffers/files here are
        // not a concern for RAM; watch serial logs for capture failures
        // or heap pressure if this ever gets pushed further.
        .frame_size = FRAMESIZE_UXGA,
        .jpeg_quality = 5,
        .fb_count = 2,
        .fb_location = CAMERA_FB_IN_PSRAM,
        // IMPORTANT: GRAB_LATEST can stall esp_camera_fb_get() forever on
        // some OV2640 units after the first frame. WHEN_EMPTY is reliable.
        .grab_mode = CAMERA_GRAB_WHEN_EMPTY,
    };

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_camera_init failed: 0x%x", err);
        return err;
    }

    sensor_t *s = esp_camera_sensor_get();
    if (s != NULL) {
        // Sensible defaults for an indoor/window weather cam.
        s->set_brightness(s, 0);
        s->set_saturation(s, 0);
        s->set_ae_level(s, 0);
    }

    ESP_LOGI(TAG, "camera initialized");
    return ESP_OK;
}

camera_fb_t *app_cam_grab(void)
{
    return esp_camera_fb_get();
}

void app_cam_release(camera_fb_t *fb)
{
    if (fb != NULL) {
        esp_camera_fb_return(fb);
    }
}
