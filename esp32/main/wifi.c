#include "wifi.h"

#include <string.h>

#include "esp_attr.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

#include "secrets.h"

static const char *TAG = "wifi";

static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT BIT1

#define WIFI_MAX_RETRY 10

// Hard ceiling on the whole association+DHCP dance. Without it a hung
// connect would keep the board awake (and warm) indefinitely; missing one
// 60s frame and retrying after a deep sleep is the cheaper failure mode.
#define WIFI_CONNECT_TIMEOUT_MS 30000

// Surviving deep sleep: remembering which channel/BSSID we associated with
// last time turns the next connect from a full all-channel scan into a
// directed probe, which is the single biggest chunk of wake time we can cut.
RTC_DATA_ATTR static uint8_t s_cached_bssid[6];
RTC_DATA_ATTR static uint8_t s_cached_channel;
RTC_DATA_ATTR static bool s_cached_valid;

static bool s_using_cache;
static int s_retry_num = 0;

static void apply_sta_config(bool use_cache)
{
    wifi_config_t wifi_config = {0};
    strncpy((char *)wifi_config.sta.ssid, WIFI_SSID, sizeof(wifi_config.sta.ssid) - 1);
    strncpy((char *)wifi_config.sta.password, WIFI_PASS, sizeof(wifi_config.sta.password) - 1);
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    if (use_cache) {
        memcpy(wifi_config.sta.bssid, s_cached_bssid, sizeof(s_cached_bssid));
        wifi_config.sta.bssid_set = true;
        wifi_config.sta.channel = s_cached_channel;
    }

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
}

static void event_handler(void *arg, esp_event_base_t event_base,
                           int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        // A cached BSSID/channel goes stale whenever the AP moves channel or
        // we roam between mesh nodes. Burn the cache once and fall back to a
        // full scan before counting this against the retry budget.
        if (s_using_cache) {
            ESP_LOGW(TAG, "fast connect failed, falling back to full scan");
            s_using_cache = false;
            s_cached_valid = false;
            apply_sta_config(false);
            esp_wifi_connect();
            return;
        }

        if (s_retry_num < WIFI_MAX_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGW(TAG, "retrying connection to AP (%d/%d)", s_retry_num, WIFI_MAX_RETRY);
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "got ip: " IPSTR, IP2STR(&event->ip_info.ip));

        wifi_ap_record_t ap;
        if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
            memcpy(s_cached_bssid, ap.bssid, sizeof(s_cached_bssid));
            s_cached_channel = ap.primary;
            s_cached_valid = true;
        }

        s_retry_num = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

esp_err_t wifi_connect(void)
{
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    // The credentials are compiled in and we reconnect from scratch every
    // wake, so there is nothing worth persisting. Keeping the config in RAM
    // avoids an NVS (flash) write on every one of the ~1440 cycles per day.
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));

    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL));

    s_using_cache = s_cached_valid;
    if (s_using_cache) {
        ESP_LOGI(TAG, "fast connect: channel %u, bssid %02x:%02x:%02x:%02x:%02x:%02x",
                 s_cached_channel, s_cached_bssid[0], s_cached_bssid[1], s_cached_bssid[2],
                 s_cached_bssid[3], s_cached_bssid[4], s_cached_bssid[5]);
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    apply_sta_config(s_using_cache);
    ESP_ERROR_CHECK(esp_wifi_start());

    // Modem sleep: the radio parks between AP beacons instead of running the
    // receiver continuously. It costs a little latency on the first packet
    // after idle, which was the reason it used to be disabled back when a
    // frame was uploaded every 5s -- at a 60s interval (and with the board
    // asleep for most of it) the always-on receiver was just self-heating.
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_MIN_MODEM));

    ESP_LOGI(TAG, "connecting to SSID '%s' ...", WIFI_SSID);

    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
                                            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
                                            pdFALSE, pdFALSE,
                                            pdMS_TO_TICKS(WIFI_CONNECT_TIMEOUT_MS));

    if (bits & WIFI_CONNECTED_BIT) {
        return ESP_OK;
    }

    if (bits & WIFI_FAIL_BIT) {
        ESP_LOGE(TAG, "failed to connect after %d retries", WIFI_MAX_RETRY);
    } else {
        ESP_LOGE(TAG, "connect timed out after %d ms", WIFI_CONNECT_TIMEOUT_MS);
    }
    return ESP_FAIL;
}

void wifi_shutdown(void)
{
    esp_wifi_disconnect();
    esp_wifi_stop();
    esp_wifi_deinit();
}
