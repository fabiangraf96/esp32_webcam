#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include "cam.h"
#include "uploader.h"
#include "wifi.h"

static const char *TAG = "main";

#define UPLOAD_INTERVAL_MS 5000

static void upload_task(void *arg)
{
    (void)arg;

    for (;;) {
        TickType_t cycle_start = xTaskGetTickCount();

        camera_fb_t *fb = app_cam_grab();
        if (fb == NULL) {
            ESP_LOGW(TAG, "capture failed, skipping this cycle");
        } else {
            esp_err_t err = uploader_send_jpeg(fb->buf, fb->len);
            if (err != ESP_OK) {
                ESP_LOGW(TAG, "upload failed: %s", esp_err_to_name(err));
            }
            app_cam_release(fb);
        }

        // At the sensor's max resolution the JPEG buffer is much bigger,
        // so keep an eye on both heap regions for fragmentation/pressure.
        ESP_LOGI(TAG, "heap free: internal=%u psram=%u",
                 (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                 (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));

        TickType_t elapsed = xTaskGetTickCount() - cycle_start;
        TickType_t interval_ticks = pdMS_TO_TICKS(UPLOAD_INTERVAL_MS);
        if (elapsed < interval_ticks) {
            vTaskDelay(interval_ticks - elapsed);
        }
    }
}

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ESP_ERROR_CHECK(app_cam_init());
    ESP_ERROR_CHECK(wifi_connect());

    // 6 KB stack: JPEG buffer itself lives in PSRAM (fb->buf), this task
    // only needs room for the HTTPS client's call stack.
    xTaskCreate(upload_task, "upload", 6144, NULL, 5, NULL);

    ESP_LOGI(TAG, "ready - uploading every %d ms", UPLOAD_INTERVAL_MS);
}
