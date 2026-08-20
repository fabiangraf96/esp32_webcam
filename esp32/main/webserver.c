#include "webserver.h"

#include "esp_http_server.h"
#include "esp_log.h"

#include "cam.h"

static const char *TAG = "webserver";

static esp_err_t capture_handler(httpd_req_t *req)
{
    camera_fb_t *fb = app_cam_grab();
    if (fb == NULL) {
        ESP_LOGE(TAG, "camera capture failed");
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);

    app_cam_release(fb);
    return res;
}

static esp_err_t root_handler(httpd_req_t *req)
{
    static const char *body =
        "ESP32 weather webcam. Snapshot at /capture (image/jpeg).\n";
    httpd_resp_set_type(req, "text/plain");
    return httpd_resp_send(req, body, HTTPD_RESP_USE_STRLEN);
}

esp_err_t webserver_start(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    // Camera frame + JPEG headers can exceed the default header/uri limits
    // on some clients; bump stack a bit for the JPEG copy in the handler.
    config.stack_size = 8192;

    httpd_handle_t server = NULL;
    esp_err_t err = httpd_start(&server, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "httpd_start failed: 0x%x", err);
        return err;
    }

    httpd_uri_t capture_uri = {
        .uri = "/capture",
        .method = HTTP_GET,
        .handler = capture_handler,
    };
    httpd_register_uri_handler(server, &capture_uri);

    httpd_uri_t root_uri = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = root_handler,
    };
    httpd_register_uri_handler(server, &root_uri);

    ESP_LOGI(TAG, "http server started");
    return ESP_OK;
}
