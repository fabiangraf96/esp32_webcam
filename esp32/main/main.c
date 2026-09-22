#include <string.h>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include "cam.h"
#include "uploader.h"
#include "wifi.h"

static const char *TAG = "main";

#define UPLOAD_INTERVAL_US (60ULL * 1000 * 1000)

// Floor on the sleep window. If a cycle ever overruns the interval (a slow
// upload, a long WiFi retry) we still want the board to spend some time cold
// rather than rolling straight into the next capture.
#define MIN_SLEEP_US (5ULL * 1000 * 1000)

// The OV2640 is cold-started every cycle, so the first frames come out before
// auto-exposure/auto-gain have converged and look dark or colour-shifted.
#define CAM_WARMUP_FRAMES 2

// Does not return.
static void enter_deep_sleep(void)
{
    // esp_timer_get_time() is microseconds since boot, which for this
    // firmware is exactly the time the board has been drawing full power.
    int64_t awake_us = esp_timer_get_time();
    int64_t sleep_us = (int64_t)UPLOAD_INTERVAL_US - awake_us;
    if (sleep_us < (int64_t)MIN_SLEEP_US) {
        ESP_LOGW(TAG, "cycle overran the interval (awake %lld ms)", (long long)(awake_us / 1000));
        sleep_us = (int64_t)MIN_SLEEP_US;
    }

    ESP_LOGI(TAG, "awake %lld ms, sleeping %lld ms",
             (long long)(awake_us / 1000), (long long)(sleep_us / 1000));

    ESP_ERROR_CHECK(esp_sleep_enable_timer_wakeup((uint64_t)sleep_us));
    esp_deep_sleep_start();
}

void app_main(void)
{
    if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TIMER) {
        ESP_LOGI(TAG, "cold boot");
    }

    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Releases the PWDN latch held through deep sleep and waits for the
    // sensor's rails to come up.
    app_cam_power_on();

    if (app_cam_init() != ESP_OK) {
        // Rebooting into the same failure in a tight loop would be worse than
        // losing a frame: sleep and give the sensor a fully cold restart.
        app_cam_power_off();
        enter_deep_sleep();
    }

    // Associating takes a second or two, which doubles as the sensor's
    // auto-exposure settling window.
    if (wifi_connect() != ESP_OK) {
        app_cam_deinit();
        app_cam_power_off();
        wifi_shutdown();
        enter_deep_sleep();
    }

    app_cam_discard_frames(CAM_WARMUP_FRAMES);

    camera_fb_t *fb = app_cam_grab();
    uint8_t *jpeg = NULL;
    size_t jpeg_len = 0;

    if (fb != NULL) {
        // Copy the frame out of the driver's buffer so the sensor can be shut
        // down *before* the upload. The TLS handshake is the cycle's biggest
        // radio burst and there is no reason to have the camera's analog rail
        // loaded at the same time.
        jpeg = heap_caps_malloc(fb->len, MALLOC_CAP_SPIRAM);
        if (jpeg != NULL) {
            memcpy(jpeg, fb->buf, fb->len);
            jpeg_len = fb->len;
            app_cam_release(fb);
            fb = NULL;
        } else {
            ESP_LOGW(TAG, "no PSRAM for frame copy, uploading with camera still on");
        }
    }

    if (fb == NULL) {
        app_cam_deinit();
        app_cam_power_off();
    }

    if (jpeg != NULL) {
        esp_err_t err = uploader_send_jpeg(jpeg, jpeg_len);
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "upload failed: %s", esp_err_to_name(err));
        }
        heap_caps_free(jpeg);
    } else if (fb != NULL) {
        esp_err_t err = uploader_send_jpeg(fb->buf, fb->len);
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "upload failed: %s", esp_err_to_name(err));
        }
        app_cam_release(fb);
        app_cam_deinit();
        app_cam_power_off();
    } else {
        ESP_LOGW(TAG, "capture failed, skipping this cycle");
    }

    ESP_LOGI(TAG, "heap free: internal=%u psram=%u",
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));

    wifi_shutdown();
    enter_deep_sleep();
}
