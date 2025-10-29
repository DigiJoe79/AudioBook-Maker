# Tauri App Icons

Place your app icons here. Required icons:

## Windows
- `icon.ico` - Windows icon file

## macOS
- `icon.icns` - macOS icon file

## Linux & General
- `32x32.png` - 32x32 PNG icon
- `128x128.png` - 128x128 PNG icon
- `128x128@2x.png` - 256x256 PNG icon (for retina displays)
- `icon.png` - 512x512 PNG icon (or 1024x1024 for best quality)

## Generate Icons

You can use the `tauri icon` command to generate all required icons from a single 1024x1024 PNG:

```bash
npm run tauri icon path/to/icon.png
```

For now, copy the icons from `resources/icons/` in the main project.