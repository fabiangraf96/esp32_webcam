ich will auf meiner website einen butto haben auf dem ich zu meiner seite gelange wo ich eine live webcam aus meinem zimmer heraus sehe.
es soll ein esp32 arduion cam sein.
dieser wird einfach über usb an stromversorgung angeschlossen und hängt im heim wlan.
auch im heim wlan liegt mein raspbi auf den ich über ssh fabian@raspberrypi2.local komme.
hier soll ein skript laufen welches die daten vom esp32 an meine website auf cloudfare weitergibt.
meine cloudfare website heißt aktuell: https://fabian-graf-website.pages.dev/ und ist privat im repo hier: https://github.com/fabiangraf96/fabian_graf_website


das repo \\wsl.localhost\Ubuntu\home\fabian\git\playground\esp_webcam soll den code für die esp32 webcam sowie für das zeug auf dem raspbi führen.
es wird private auf github gehostet werden später mal.
trotzdem sollen meine credetials wie raspberrypi2 password und wlan ssid und pw natürlich nicht in github liegen.

folgende schritte bitte:
1.) software für den esp schreiben und flashen. der esp hängt bereits im WSL verfügbar. hier liegt auch esp idf sdk.
2.) software für den raspberrypi2 der bereits im wlan hängt.
3.) durchreichen des live bilds (muss kein stream sein sondern eher paar fps eben) an meine website in separatem tab also nicht auf der startseite. es soll eine wetter webcam sein
