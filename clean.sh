#!/bin/bash

# Скрипт очистки проекта Tauri от файлов сборки и разработки

echo "Очистка проекта Tauri..."

# Удаление node_modules
if [ -d "node_modules" ]; then
    echo "Удаление node_modules..."
    rm -rf node_modules
    echo "✓ node_modules удален"
fi

# Удаление директории сборки Rust
if [ -d "src-tauri/target" ]; then
    echo "Удаление src-tauri/target..."
    rm -rf src-tauri/target
    echo "✓ src-tauri/target удален"
fi

# Удаление собранных файлов фронтенда
if [ -d "dist" ]; then
    echo "Удаление dist..."
    rm -rf dist
    echo "✓ dist удален"
fi

# Удаление кэша Vite
if [ -d ".vite" ]; then
    echo "Удаление .vite..."
    rm -rf .vite
    echo "✓ .vite удален"
fi

# Удаление временных файлов Tauri
if [ -d ".tauri" ]; then
    echo "Удаление .tauri..."
    rm -rf .tauri
    echo "✓ .tauri удален"
fi

# Удаление логов
echo "Удаление логов..."
find . -name "*.log" -type f -delete 2>/dev/null
echo "✓ Логи удалены"

# Удаление lock файлов (опционально, раскомментируйте если нужно)
# if [ -f "package-lock.json" ]; then
#     rm -f package-lock.json
# fi
# if [ -f "yarn.lock" ]; then
#     rm -f yarn.lock
# fi

echo ""
echo "Очистка завершена!"
