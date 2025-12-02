# APP打包工具

一个本地网页工具，用于打包Android和iOS项目的Release版本。

## 功能特性

- ✅ 支持Android Release打包
- ✅ 支持iOS Release打包
- ✅ 自动检测项目类型（Android/iOS）
- ✅ 友好的Web界面
- ✅ 实时显示打包输出
- ✅ 按日期自动创建输出文件夹（格式：YYYY-MM-DD）
- ✅ 自动复制打包文件到输出目录

## 安装步骤

1. 安装Node.js依赖：
```bash
npm install
```

## 使用方法

1. 启动服务器：
```bash
npm start
```

2. 在浏览器中打开：
```
http://localhost:3000
```

3. 使用步骤：
   - 在"项目路径"输入框中输入或粘贴项目路径（例如：`/Users/username/projects/myapp`）
   - 在"输出包文件夹"输入框中输入输出路径（例如：`/Users/username/outputs`）
   - 点击"检查项目"按钮，系统会自动检测项目类型
   - 选择要打包的类型（仅Android、仅iOS、或两者）
   - 点击"开始打包"按钮

## 项目要求

### Android项目
- 需要包含 `android/gradlew` 文件
- 项目结构应包含 `android/build.gradle`

### iOS项目
- 需要包含 `ios` 目录
- 需要包含 `.xcworkspace` 或 `.xcodeproj` 文件

## 打包输出位置

打包完成后，所有文件会自动复制到输出包文件夹中按日期创建的子文件夹：

### 输出目录结构
```
输出包文件夹/
└── YYYY-MM-DD/          # 日期文件夹（例如：2024-01-15）
    ├── android/         # Android打包文件
    │   ├── apk/
    │   │   └── release/  # APK文件
    │   └── bundle/
    │       └── release/  # AAB文件
    └── ios/             # iOS打包文件
        └── [项目名].xcarchive
```

### 原始构建输出位置

#### Android
- APK文件通常位于：`android/app/build/outputs/apk/release/`
- AAB文件通常位于：`android/app/build/outputs/bundle/release/`

#### iOS
- Archive文件位于：`ios/build/[项目名].xcarchive`

**注意**：打包完成后，文件会自动复制到输出包文件夹的日期子文件夹中，方便管理和查找。

## 注意事项

1. **Android打包**：
   - 确保已安装Java JDK和Android SDK
   - 确保gradlew有执行权限（脚本会自动设置）

2. **iOS打包**：
   - 需要在macOS系统上运行
   - 需要安装Xcode命令行工具
   - 打包可能需要配置签名（当前版本使用无签名打包）

3. **路径格式**：
   - macOS/Linux: `/Users/username/projects/myapp`
   - Windows: `C:\Users\username\projects\myapp`

## 开发模式

使用nodemon自动重启（需要先安装nodemon）：
```bash
npm run dev
```

## 技术栈

- 后端：Node.js + Express
- 前端：原生HTML/CSS/JavaScript
- 打包工具：
  - Android: Gradle (`./gradlew assembleRelease`)
  - iOS: Xcode Build System (`xcodebuild`)

## 许可证

MIT

# appPack
