#include "esp_log.h"
#include "nvs_flash.h"

#include "cam.h"
#include "webserver.h"
#include "wifi.h"

static const char *TAG = "main";

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
    ESP_ERROR_CHECK(webserver_start());

    ESP_LOGI(TAG, "ready - GET /capture for a snapshot");
}
