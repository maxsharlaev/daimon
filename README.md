# daimon

GUI-приложение на **Golang + Wails** с настраиваемым интерфейсом (две панели, можно менять “терминал слева/справа”) и встроенным **SSH-терминалом** (MVP).

## Что уже сделано (MVP)

- **Две панели** с draggable-разделителем (можно менять ширину).
- **Переключение стороны терминала** (Left/Right).
- **Терминал** на базе xterm.js.
- **SSH**:
  - пароль
  - приватный ключ (файл) + optional passphrase
  - проверка подключения (`Test`)
  - интерактивная shell-сессия (`Connect`) со стримингом вывода через Wails Events.

## Запуск (Windows / PowerShell)

В корне проекта:

```bash
wails dev
```

## Сборка

```bash
wails build
```

## Как проверить SSH

1. Запустите приложение (`wails dev`).
2. В панели **Connection** задайте `Host/Port/User`.
3. Выберите **Password** или **Key**:
   - **Password**: введите пароль.
   - **Key**: выберите файл приватного ключа (кнопка Browse…); при необходимости укажите passphrase.
4. Нажмите **Test** (ожидаемый результат: `daimon-ok`).
5. Нажмите **Connect** — терминал начнёт интерактивную SSH shell-сессию.

## Важное про Host Key Verification

Сейчас есть опция **Insecure: ignore host key (MVP)**:

- **Включено (по умолчанию)**: используется `InsecureIgnoreHostKey` — удобно для быстрой проверки, но **небезопасно**.
- **Выключено**: включается проверка host key через `~/.ssh/known_hosts`.
  - Если файла нет, бэкенд вернёт ошибку и попросит либо создать `known_hosts`, либо включить insecure режим.

## Архитектура (кратко)

- Go бэкенд:
  - `app.go`: публичные методы для фронтенда (`SSHConnect/SSHSend/SSHResize/...`).
  - `ssh_manager.go`: SSH диал, PTY shell, стрим вывода событиями `ssh:output` и `ssh:state`.
- Frontend:
  - `frontend/src/components/TerminalPanel.tsx`: xterm.js + отправка ввода в Go + приём событий.
  - `frontend/src/components/ConnectionPanel.tsx`: форма SSH параметров + Test/Connect/Disconnect.
  - `frontend/src/components/SplitView.tsx`: ресайз 2 панелей.
