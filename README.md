# React + Tailwind + shadcn/ui

Приложение настроено для публикации на **GitHub Pages**.

## Локальный запуск

```bash
npm install
npm run dev
```

## Деплой на GitHub Pages

1. Переименуйте рабочую ветку в `main` (или измените ветку в `.github/workflows/deploy-pages.yml`).
2. В репозитории откройте **Settings → Pages**.
3. В разделе **Build and deployment** выберите **Source: GitHub Actions**.
4. Запушьте изменения в `main` — workflow `Deploy to GitHub Pages` соберёт и опубликует `dist`.

После успешного деплоя приложение будет доступно по адресу вида:

`https://<ваш-логин>.github.io/<имя-репозитория>/`
