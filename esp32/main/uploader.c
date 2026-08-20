#include "uploader.h"

#include <stdio.h>

#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"

#include "secrets.h"

static const char *TAG = "uploader";

esp_err_t uploader_send_jpeg(const uint8_t *data, size_t len)
{
    esp_http_client_config_t config = {
        .url = UPLOAD_URL,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 10000,
        // Verify the server cert against ESP-IDF's bundled Mozilla CA set
        // (covers Cloudflare's public certs) instead of pinning a cert.
        .crt_bundle_attach = esp_crt_bundle_attach,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == NULL) {
        ESP_LOGE(TAG, "failed to init http client");
        return ESP_FAIL;
    }

    char auth_header[128];
    snprintf(auth_header, sizeof(auth_header), "Bearer %s", UPLOAD_TOKEN);
    esp_http_client_set_header(client, "Authorization", auth_header);
    esp_http_client_set_header(client, "Content-Type", "image/jpeg");
    esp_http_client_set_post_field(client, (const char *)data, (int)len);

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status = esp_http_client_get_status_code(client);
        if (status != 200) {
            ESP_LOGW(TAG, "upload rejected: HTTP %d", status);
            err = ESP_FAIL;
        } else {
            ESP_LOGI(TAG, "uploaded %d bytes", (int)len);
        }
    } else {
        ESP_LOGW(TAG, "upload request failed: %s", esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    return err;
}
