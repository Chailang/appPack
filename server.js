const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 检查项目类型
function detectProjectType(projectPath) {
  const types = [];
  const projectInfo = {
    android: null,
    ios: null,
    flutter: null
  };
  
  try {
    // 读取项目目录下的所有子目录
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const dirPath = path.join(projectPath, entry.name);
      const dirName = entry.name.toLowerCase();
      
      // 检测Flutter项目 - 查找flutter_jc目录（包含pubspec.yaml）
      if (!projectInfo.flutter && (dirName === 'flutter_jc' || dirName.includes('flutter'))) {
        const hasPubspec = fs.existsSync(path.join(dirPath, 'pubspec.yaml'));
        if (hasPubspec) {
          projectInfo.flutter = entry.name;
          // 如果检测到flutter_jc，将其识别为Flutter项目
          if (dirName === 'flutter_jc') {
            types.push('flutter');
          }
        }
      }
      
      // 检测Android项目 - 查找包含gradlew或build.gradle的目录
      if (!projectInfo.android) {
        const hasGradlew = fs.existsSync(path.join(dirPath, 'gradlew')) || 
                           fs.existsSync(path.join(dirPath, 'gradlew.bat'));
        const hasBuildGradle = fs.existsSync(path.join(dirPath, 'build.gradle')) || 
                               fs.existsSync(path.join(dirPath, 'app', 'build.gradle'));
        if (hasGradlew || hasBuildGradle) {
          projectInfo.android = entry.name;
          types.push('android');
        }
      }
      
      // 检测iOS项目 - 查找包含.xcworkspace或.xcodeproj的目录
      if (!projectInfo.ios) {
        try {
          const files = fs.readdirSync(dirPath);
          const hasWorkspace = files.some(f => {
            const filePath = path.join(dirPath, f);
            try {
              return fs.statSync(filePath).isDirectory() && f.endsWith('.xcworkspace');
            } catch {
              return false;
            }
          });
          const hasProject = files.some(f => {
            const filePath = path.join(dirPath, f);
            try {
              return fs.statSync(filePath).isDirectory() && f.endsWith('.xcodeproj');
            } catch {
              return false;
            }
          });
          if (hasWorkspace || hasProject) {
            projectInfo.ios = entry.name;
            types.push('ios');
          }
        } catch (error) {
          // 跳过无法读取的目录
        }
      }
    }
  } catch (error) {
    console.error('读取项目目录失败:', error);
  }
  
  return { types, projectInfo };
}

// 递归复制目录
function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 复制文件或目录
function copyToDestination(src, dest) {
  try {
    if (!fs.existsSync(src)) {
      return { success: false, message: `源路径不存在: ${src}` };
    }
    
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyDirectory(src, dest);
      return { success: true, message: `已复制目录: ${src} -> ${dest}` };
    } else {
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(src, dest);
      return { success: true, message: `已复制文件: ${src} -> ${dest}` };
    }
  } catch (error) {
    return { success: false, message: `复制失败: ${error.message}` };
  }
}

// 获取日期文件夹名称（格式：YYYY-MM-DD）
function getDateFolderName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 获取iOS输出目录名称（格式：Scheme YYYY-MM-DD HH-MM-SS）
function getIOSOutputDirName(schemeName) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${schemeName} ${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
}

// 查找Android项目目录
function findAndroidDirectory(projectPath) {
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(projectPath, entry.name);
      const hasGradlew = fs.existsSync(path.join(dirPath, 'gradlew')) || 
                         fs.existsSync(path.join(dirPath, 'gradlew.bat'));
      const hasBuildGradle = fs.existsSync(path.join(dirPath, 'build.gradle')) || 
                            fs.existsSync(path.join(dirPath, 'app', 'build.gradle'));
      if (hasGradlew || hasBuildGradle) {
        return entry.name;
      }
    }
  } catch (error) {
    console.error('查找Android目录失败:', error);
  }
  return null;
}

// Android打包（带进度）
function buildAndroidWithProgress(projectPath, outputPath, sessionId, callback) {
  const session = buildSessions.get(sessionId);
  if (!session) return;

  function addLog(type, message) {
    const log = { type, message, timestamp: new Date().toISOString() };
    session.logs.push(log);
    console.log(`[${sessionId}] [${type}] ${message}`);
  }

  // 查找Android项目目录
  const androidDirName = findAndroidDirectory(projectPath);
  if (!androidDirName) {
    return callback(new Error('未找到Android项目目录'));
  }
  
  const androidPath = path.join(projectPath, androidDirName);
  const gradlewPath = path.join(androidPath, 'gradlew');
  
  // 检查gradlew是否存在
  if (!fs.existsSync(gradlewPath)) {
    return callback(new Error('未找到gradlew文件，请确保这是Android项目'));
  }

  // 确保gradlew有执行权限
  fs.chmodSync(gradlewPath, '755');

  // 构建打包命令 - 只打包 JcApkRelease 变体
  const buildCommand = process.platform === 'win32' 
    ? `${gradlewPath} clean assembleJcApkRelease bundleJcApkRelease`
    : `./gradlew clean assembleJcApkRelease bundleJcApkRelease`;

  addLog('info', `开始执行Android打包命令: ${buildCommand}`);
  addLog('info', `工作目录: ${androidPath}`);
  addLog('info', '打包变体: JcApkRelease');

  // 使用spawn实时输出
  const args = ['clean', 'assembleJcApkRelease', 'bundleJcApkRelease'];
  const gradleProcess = spawn('./gradlew', args, {
    cwd: androidPath,
    env: { ...process.env, TERM: 'xterm-color' }
  });

  let stdout = '';
  let stderr = '';

  gradleProcess.stdout.on('data', (data) => {
    const text = data.toString();
    stdout += text;
    // 发送实时日志
    addLog('output', text);
  });

  gradleProcess.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    // 发送实时日志
    addLog('error', text);
  });

  gradleProcess.on('close', (code) => {
    if (code !== 0) {
      addLog('error', `Android打包失败，退出代码: ${code}`);
      return callback(new Error(`打包失败，退出代码: ${code}`), stdout + stderr);
    }

    addLog('success', 'Android打包命令执行完成，开始复制文件...');
    
    // 打包成功后，查找和复制文件
    try {
      const dateFolder = getDateFolderName();
      const outputDateDir = path.join(outputPath, dateFolder, 'android');
      let copiedFiles = [];
      
      // 查找APK文件
      const possibleApkPaths = [
        path.join(androidPath, 'build', 'app', 'outputs', 'apk'),
        path.join(androidPath, 'app', 'build', 'outputs', 'apk'),
      ];
      
      for (const apkBasePath of possibleApkPaths) {
        if (fs.existsSync(apkBasePath)) {
          addLog('info', `找到APK目录: ${apkBasePath}`);
          try {
            const variants = fs.readdirSync(apkBasePath, { withFileTypes: true });
            for (const variant of variants) {
              if (!variant.isDirectory()) continue;
              const variantPath = path.join(apkBasePath, variant.name);
              const releasePath = path.join(variantPath, 'release');
              
              if (fs.existsSync(releasePath)) {
                const apkFiles = fs.readdirSync(releasePath).filter(f => f.endsWith('.apk'));
                addLog('info', `变体 ${variant.name} 找到 ${apkFiles.length} 个APK文件`);
                
                const outputVariantPath = path.join(outputDateDir, 'apk', variant.name, 'release');
                const result = copyToDestination(releasePath, outputVariantPath);
                if (result.success) {
                  copiedFiles.push(`APK (${variant.name}): ${apkFiles.length} 个文件`);
                  addLog('success', `已复制APK: ${variant.name}`);
                }
              }
            }
          } catch (error) {
            addLog('error', `复制APK变体时出错: ${error.message}`);
          }
          break;
        }
      }
      
      // 查找AAB文件
      const possibleBundlePaths = [
        path.join(androidPath, 'build', 'app', 'outputs', 'bundle'),
        path.join(androidPath, 'app', 'build', 'outputs', 'bundle'),
      ];
      
      for (const bundleBasePath of possibleBundlePaths) {
        if (fs.existsSync(bundleBasePath)) {
          addLog('info', `找到AAB目录: ${bundleBasePath}`);
          try {
            const variants = fs.readdirSync(bundleBasePath, { withFileTypes: true });
            for (const variant of variants) {
              if (!variant.isDirectory()) continue;
              const variantPath = path.join(bundleBasePath, variant.name);
              const releasePath = path.join(variantPath, 'release');
              
              if (fs.existsSync(releasePath)) {
                const aabFiles = fs.readdirSync(releasePath).filter(f => f.endsWith('.aab'));
                addLog('info', `变体 ${variant.name} 找到 ${aabFiles.length} 个AAB文件`);
                
                const outputVariantPath = path.join(outputDateDir, 'bundle', variant.name, 'release');
                const result = copyToDestination(releasePath, outputVariantPath);
                if (result.success) {
                  copiedFiles.push(`AAB (${variant.name}): ${aabFiles.length} 个文件`);
                  addLog('success', `已复制AAB: ${variant.name}`);
                }
              }
            }
          } catch (error) {
            addLog('error', `复制AAB变体时出错: ${error.message}`);
          }
          break;
        }
      }
      
      let outputMsg = `\n✅ Android打包成功完成！\n`;
      outputMsg += `📁 输出目录: ${outputDateDir}\n`;
      if (copiedFiles.length > 0) {
        outputMsg += `\n已复制 ${copiedFiles.length} 个文件：\n`;
        copiedFiles.forEach(file => {
          outputMsg += `  ✓ ${file}\n`;
        });
      } else {
        outputMsg += '\n⚠️ 警告: 未找到APK或AAB文件\n';
      }
      callback(null, outputMsg);
    } catch (copyError) {
      addLog('error', `复制文件时出错: ${copyError.message}`);
      callback(null, `\n⚠️ 打包成功，但复制文件时出错: ${copyError.message}`);
    }
  });

  gradleProcess.on('error', (error) => {
    addLog('error', `执行打包命令时出错: ${error.message}`);
    callback(error, `执行打包命令时出错: ${error.message}`);
  });
}

// Android打包（旧版本，保持兼容）
function buildAndroid(projectPath, outputPath, callback) {
  // 查找Android项目目录
  const androidDirName = findAndroidDirectory(projectPath);
  if (!androidDirName) {
    return callback(new Error('未找到Android项目目录'));
  }
  
  const androidPath = path.join(projectPath, androidDirName);
  const gradlewPath = path.join(androidPath, 'gradlew');
  
  // 检查gradlew是否存在
  if (!fs.existsSync(gradlewPath)) {
    return callback(new Error('未找到gradlew文件，请确保这是Android项目'));
  }

  // 确保gradlew有执行权限
  fs.chmodSync(gradlewPath, '755');

  // 构建打包命令 - 只打包 JcApkRelease 变体
  const buildCommand = process.platform === 'win32' 
    ? `${gradlewPath} clean assembleJcApkRelease bundleJcApkRelease`
    : `./gradlew clean assembleJcApkRelease bundleJcApkRelease`;

  console.log('========================================');
  console.log('开始执行Android打包命令');
  console.log('工作目录:', androidPath);
  console.log('打包命令:', buildCommand);
  console.log('========================================');

  exec(buildCommand, { 
    cwd: androidPath,
    maxBuffer: 1024 * 1024 * 50, // 50MB buffer for large builds
    env: { ...process.env, TERM: 'xterm-color' } // 保持颜色输出
  }, async (error, stdout, stderr) => {
    const hasError = error !== null;
    
    console.log('========================================');
    if (hasError) {
      console.error('❌ Android打包失败');
      console.error('错误代码:', error.code);
      console.error('错误信息:', error.message);
      console.error('标准错误输出:', stderr);
      console.error('标准输出:', stdout);
      console.log('========================================');
      // 打包失败，直接返回错误
      return callback(error, `打包失败:\n${stdout}\n${stderr}\n错误: ${error.message}`);
    } else {
      console.log('✅ Android打包成功完成');
      console.log('构建输出:', stdout.substring(0, 500) + '...'); // 只显示前500字符
    }
    console.log('========================================');
    
    // 打包成功后，查找和复制文件
    console.log('开始查找和复制打包文件...');
    try {
      const dateFolder = getDateFolderName();
      const outputDateDir = path.join(outputPath, dateFolder, 'android');
      let copiedFiles = [];
      
      // 查找APK文件 - 检查多个可能的路径
      const possibleApkPaths = [
        path.join(androidPath, 'build', 'app', 'outputs', 'apk'),  // 新路径：build/app/outputs/apk
        path.join(androidPath, 'app', 'build', 'outputs', 'apk'),  // 旧路径：app/build/outputs/apk
      ];
      
      console.log('查找APK文件，检查路径:', possibleApkPaths);
      
      for (const apkBasePath of possibleApkPaths) {
        if (fs.existsSync(apkBasePath)) {
          console.log('找到APK目录:', apkBasePath);
          // 复制所有变体的APK文件
          try {
            const variants = fs.readdirSync(apkBasePath, { withFileTypes: true });
            console.log('找到变体:', variants.map(v => v.name).join(', '));
            
            for (const variant of variants) {
              if (!variant.isDirectory()) continue;
              const variantPath = path.join(apkBasePath, variant.name);
              const releasePath = path.join(variantPath, 'release');
              
              if (fs.existsSync(releasePath)) {
                // 查找所有APK文件
                const apkFiles = fs.readdirSync(releasePath).filter(f => f.endsWith('.apk'));
                console.log(`变体 ${variant.name} 找到 ${apkFiles.length} 个APK文件`);
                
                const outputVariantPath = path.join(outputDateDir, 'apk', variant.name, 'release');
                const result = copyToDestination(releasePath, outputVariantPath);
                if (result.success) {
                  copiedFiles.push(`APK (${variant.name}): ${apkFiles.length} 个文件 -> ${outputVariantPath}`);
                } else {
                  console.error('复制失败:', result.message);
                }
              }
            }
          } catch (error) {
            console.error('复制APK变体时出错:', error);
          }
          break; // 找到路径后退出循环
        }
      }
      
      // 查找AAB文件 - 检查多个可能的路径
      const possibleBundlePaths = [
        path.join(androidPath, 'build', 'app', 'outputs', 'bundle'),  // 新路径
        path.join(androidPath, 'app', 'build', 'outputs', 'bundle'),  // 旧路径
      ];
      
      console.log('查找AAB文件，检查路径:', possibleBundlePaths);
      
      for (const bundleBasePath of possibleBundlePaths) {
        if (fs.existsSync(bundleBasePath)) {
          console.log('找到AAB目录:', bundleBasePath);
          try {
            const variants = fs.readdirSync(bundleBasePath, { withFileTypes: true });
            console.log('找到AAB变体:', variants.map(v => v.name).join(', '));
            
            for (const variant of variants) {
              if (!variant.isDirectory()) continue;
              const variantPath = path.join(bundleBasePath, variant.name);
              const releasePath = path.join(variantPath, 'release');
              
              if (fs.existsSync(releasePath)) {
                const aabFiles = fs.readdirSync(releasePath).filter(f => f.endsWith('.aab'));
                console.log(`变体 ${variant.name} 找到 ${aabFiles.length} 个AAB文件`);
                
                const outputVariantPath = path.join(outputDateDir, 'bundle', variant.name, 'release');
                const result = copyToDestination(releasePath, outputVariantPath);
                if (result.success) {
                  copiedFiles.push(`AAB (${variant.name}): ${aabFiles.length} 个文件 -> ${outputVariantPath}`);
                } else {
                  console.error('复制失败:', result.message);
                }
              }
            }
          } catch (error) {
            console.error('复制AAB变体时出错:', error);
          }
          break;
        }
      }
      
      // 构建输出消息
      let outputMsg = `\n✅ Android打包成功完成！\n`;
      outputMsg += `📁 输出目录: ${outputDateDir}\n`;
      if (copiedFiles.length > 0) {
        outputMsg += '\n\n已复制文件：\n' + copiedFiles.join('\n');
      } else {
        outputMsg += '\n\n⚠️ 未找到APK或AAB文件';
        outputMsg += '\n请检查以下路径：';
        possibleApkPaths.forEach(p => outputMsg += `\n  - ${p}`);
        possibleBundlePaths.forEach(p => outputMsg += `\n  - ${p}`);
      }
      
      callback(null, outputMsg);
    } catch (copyError) {
      console.error('复制Android文件时出错:', copyError);
      const errorMsg = hasError 
        ? `\n⚠️ 打包失败: ${error.message}\n⚠️ 复制文件时也出错: ${copyError.message}`
        : `\n⚠️ 打包成功，但复制文件时出错: ${copyError.message}`;
      callback(hasError ? error : null, stdout + (stderr ? '\n' + stderr : '') + errorMsg);
    }
  });
}

// 查找iOS项目目录
function findIOSDirectory(projectPath) {
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(projectPath, entry.name);
      try {
        const files = fs.readdirSync(dirPath);
        const hasWorkspace = files.some(f => {
          const filePath = path.join(dirPath, f);
          try {
            return fs.statSync(filePath).isDirectory() && f.endsWith('.xcworkspace');
          } catch {
            return false;
          }
        });
        const hasProject = files.some(f => {
          const filePath = path.join(dirPath, f);
          try {
            return fs.statSync(filePath).isDirectory() && f.endsWith('.xcodeproj');
          } catch {
            return false;
          }
        });
        if (hasWorkspace || hasProject) {
          return entry.name;
        }
      } catch (error) {
        // 跳过无法读取的目录
      }
    }
  } catch (error) {
    console.error('查找iOS目录失败:', error);
  }
  return null;
}

// iOS打包（带进度）
function buildIOSWithProgress(projectPath, outputPath, sessionId, callback) {
  const session = buildSessions.get(sessionId);
  if (!session) return;

  function addLog(type, message) {
    const log = { type, message, timestamp: new Date().toISOString() };
    session.logs.push(log);
    console.log(`[${sessionId}] [${type}] ${message}`);
  }

  // 查找iOS项目目录
  const iosDirName = findIOSDirectory(projectPath);
  if (!iosDirName) {
    return callback(new Error('未找到iOS项目目录'));
  }
  
  const iosPath = path.join(projectPath, iosDirName);
  
  if (!fs.existsSync(iosPath)) {
    return callback(new Error('未找到iOS项目目录'));
  }

  // 查找.xcworkspace或.xcodeproj
  const files = fs.readdirSync(iosPath);
  let workspaceFile = null;
  let projectFile = null;

  for (const file of files) {
    const filePath = path.join(iosPath, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && file.endsWith('.xcworkspace')) {
      workspaceFile = file;
      break;
    } else if (stat.isDirectory() && file.endsWith('.xcodeproj')) {
      projectFile = file;
    }
  }

  if (!workspaceFile && !projectFile) {
    return callback(new Error('未找到.xcworkspace或.xcodeproj文件'));
  }

  // 获取scheme名称
  const schemeName = projectFile 
    ? path.basename(projectFile, '.xcodeproj')
    : path.basename(workspaceFile, '.xcworkspace');

  // 确保build目录存在
  const buildDir = path.join(iosPath, 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  const archivePath = path.join(buildDir, `${schemeName}.xcarchive`);

  // 构建Archive命令
  // 需要指定destination为generic/platform=iOS，否则可能选择macOS导致失败
  let archiveArgs;
  if (workspaceFile) {
    archiveArgs = [
      '-workspace', workspaceFile,
      '-scheme', schemeName,
      '-configuration', 'Release',
      '-destination', 'generic/platform=iOS',
      'archive',
      '-archivePath', archivePath
    ];
  } else {
    archiveArgs = [
      '-project', projectFile,
      '-scheme', schemeName,
      '-configuration', 'Release',
      '-destination', 'generic/platform=iOS',
      'archive',
      '-archivePath', archivePath
    ];
  }

  addLog('info', `开始执行iOS Archive命令`);
  addLog('info', `工作目录: ${iosPath}`);
  addLog('info', `Scheme: ${schemeName}`);
  addLog('info', `命令: xcodebuild ${archiveArgs.join(' ')}`);

  // 使用spawn执行Archive，设置环境变量禁用签名
  const archiveProcess = spawn('xcodebuild', archiveArgs, {
    cwd: iosPath,
    env: { 
      ...process.env, 
      TERM: 'xterm-color',
      CODE_SIGN_IDENTITY: '',
      CODE_SIGNING_REQUIRED: 'NO'
    }
  });

  let archiveStdout = '';
  let archiveStderr = '';

  archiveProcess.stdout.on('data', (data) => {
    const text = data.toString();
    archiveStdout += text;
    addLog('output', text);
  });

  archiveProcess.stderr.on('data', (data) => {
    const text = data.toString();
    archiveStderr += text;
    addLog('error', text);
  });

  archiveProcess.on('close', (code) => {
    if (code !== 0) {
      addLog('error', `iOS Archive失败，退出代码: ${code}`);
      addLog('error', `错误输出: ${archiveStderr.substring(0, 1000)}`);
      addLog('error', `标准输出: ${archiveStdout.substring(0, 500)}`);
      return callback(new Error(`Archive失败，退出代码: ${code}\n${archiveStderr.substring(0, 500)}`), archiveStdout + archiveStderr);
    }

    // 验证Archive文件是否存在
    if (!fs.existsSync(archivePath)) {
      addLog('error', `Archive文件不存在: ${archivePath}`);
      addLog('error', `请检查构建日志确认Archive是否成功创建`);
      return callback(new Error(`Archive文件不存在: ${archivePath}`), archiveStdout + archiveStderr);
    }

    addLog('success', `iOS Archive创建成功: ${archivePath}`);
    addLog('info', '开始导出IPA文件...');

    // 导出IPA
    const exportDir = path.join(buildDir, 'export');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    
    const exportOptionsPath = path.join(buildDir, 'ExportOptions.plist');
    const exportOptionsContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>release-testing</string>
    <key>compileBitcode</key>
    <false/>
    <key>stripSwiftSymbols</key>
    <true/>
</dict>
</plist>`;
    
    fs.writeFileSync(exportOptionsPath, exportOptionsContent);
    
    const exportArgs = [
      '-exportArchive',
      '-archivePath', archivePath,
      '-exportPath', exportDir,
      '-exportOptionsPlist', exportOptionsPath
    ];

    addLog('info', '开始导出IPA文件...');
    const exportProcess = spawn('xcodebuild', exportArgs, {
      cwd: iosPath,
      env: { ...process.env, TERM: 'xterm-color' }
    });

    let exportStdout = '';
    let exportStderr = '';

    exportProcess.stdout.on('data', (data) => {
      const text = data.toString();
      exportStdout += text;
      addLog('output', text);
    });

    exportProcess.stderr.on('data', (data) => {
      const text = data.toString();
      exportStderr += text;
      addLog('error', text);
    });

    exportProcess.on('close', (exportCode) => {
      const dateFolder = getDateFolderName();
      const outputDateDir = path.join(outputPath, dateFolder, 'ios');
      let copiedFiles = [];

      if (exportCode !== 0) {
        addLog('error', `导出IPA失败，退出代码: ${exportCode}`);
        addLog('error', `错误输出: ${exportStderr.substring(0, 1000)}`);
        addLog('error', `标准输出: ${exportStdout.substring(0, 500)}`);
        return callback(new Error(`导出IPA失败，退出代码: ${exportCode}\n${exportStderr.substring(0, 500)}`), exportStdout + exportStderr);
      }

      addLog('success', 'IPA导出成功，开始复制文件...');

      // 查找并复制IPA文件
      try {
        const findIPAFiles = (dir) => {
          const files = [];
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isFile() && entry.name.endsWith('.ipa')) {
                files.push(fullPath);
              } else if (entry.isDirectory()) {
                files.push(...findIPAFiles(fullPath));
              }
            }
          } catch (error) {
            addLog('error', `查找IPA文件时出错: ${error.message}`);
          }
          return files;
        };
        
        const ipaFiles = findIPAFiles(exportDir);
        addLog('info', `找到 ${ipaFiles.length} 个IPA文件`);
        
        // 找到所有包含IPA文件的目录（去重）
        const ipaDirs = new Set();
        for (const ipaFile of ipaFiles) {
          const ipaDir = path.dirname(ipaFile);
          ipaDirs.add(ipaDir);
        }
        
        // 生成带时间戳的输出目录名（格式：Scheme YYYY-MM-DD HH-MM-SS）
        const iosOutputDirName = getIOSOutputDirName(schemeName);
        const outputDirPath = path.join(outputDateDir, iosOutputDirName);
        
        // 复制所有IPA文件到统一的输出目录
        // 如果只有一个IPA目录，直接复制；如果有多个，合并到一个目录
        let allCopied = false;
        for (const ipaDir of ipaDirs) {
          // 复制整个目录（保留目录结构和时间信息）
          const copyResult = copyToDestination(ipaDir, outputDirPath);
          if (copyResult.success) {
            allCopied = true;
            // 查找这个目录中的IPA文件
            const dirIpaFiles = ipaFiles.filter(f => path.dirname(f) === ipaDir);
            dirIpaFiles.forEach(ipaFile => {
              const ipaFileName = path.basename(ipaFile);
              copiedFiles.push(`IPA文件: ${ipaFileName}`);
            });
            addLog('success', `已复制IPA目录: ${iosOutputDirName}`);
          } else {
            addLog('error', `复制目录失败: ${iosOutputDirName} - ${copyResult.message}`);
          }
        }
        
        if (!allCopied) {
          addLog('error', '复制IPA目录失败');
        }
        
        // 不复制Archive文件，只保留IPA文件
        if (copiedFiles.length === 0) {
          addLog('error', '未找到或复制任何IPA文件');
          return callback(new Error('未找到或复制任何IPA文件'), exportStdout + exportStderr);
        }
        
        let outputMsg = `\n✅ iOS打包成功完成！\n`;
        outputMsg += `📁 输出目录: ${outputDateDir}\n`;
        if (copiedFiles.length > 0) {
          outputMsg += `\n已复制 ${copiedFiles.length} 个文件：\n`;
          copiedFiles.forEach(file => {
            outputMsg += `  ✓ ${file}\n`;
          });
        }
        callback(null, outputMsg);
      } catch (copyError) {
        addLog('error', `复制文件时出错: ${copyError.message}`);
        callback(null, `\n⚠️ 打包成功，但复制文件时出错: ${copyError.message}`);
      }
    });

    exportProcess.on('error', (error) => {
      addLog('error', `执行导出命令时出错: ${error.message}`);
      callback(error, `执行导出命令时出错: ${error.message}`);
    });
  });

  archiveProcess.on('error', (error) => {
    addLog('error', `执行Archive命令时出错: ${error.message}`);
    callback(error, `执行Archive命令时出错: ${error.message}`);
  });
}

// iOS打包（旧版本，保持兼容）
function buildIOS(projectPath, outputPath, callback) {
  // 查找iOS项目目录
  const iosDirName = findIOSDirectory(projectPath);
  if (!iosDirName) {
    return callback(new Error('未找到iOS项目目录'));
  }
  
  const iosPath = path.join(projectPath, iosDirName);
  
  if (!fs.existsSync(iosPath)) {
    return callback(new Error('未找到iOS项目目录'));
  }

  // 查找.xcworkspace或.xcodeproj
  const files = fs.readdirSync(iosPath);
  let workspaceFile = null;
  let projectFile = null;

  for (const file of files) {
    const filePath = path.join(iosPath, file);
    const stat = fs.statSync(filePath);
    
    // .xcworkspace 是目录
    if (stat.isDirectory() && file.endsWith('.xcworkspace')) {
      workspaceFile = file;
      break;
    } else if (stat.isDirectory() && file.endsWith('.xcodeproj')) {
      projectFile = file;
    }
  }

  if (!workspaceFile && !projectFile) {
    return callback(new Error('未找到.xcworkspace或.xcodeproj文件'));
  }

  // 获取scheme名称（通常与项目名称相同）
  const schemeName = projectFile 
    ? path.basename(projectFile, '.xcodeproj')
    : path.basename(workspaceFile, '.xcworkspace');

  // 确保build目录存在
  const buildDir = path.join(iosPath, 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  const archivePath = path.join(buildDir, `${schemeName}.xcarchive`);

  let buildCommand;
  if (workspaceFile) {
    buildCommand = `xcodebuild -workspace "${workspaceFile}" -scheme "${schemeName}" -configuration Release archive -archivePath "${archivePath}" CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO`;
  } else {
    buildCommand = `xcodebuild -project "${projectFile}" -scheme "${schemeName}" -configuration Release archive -archivePath "${archivePath}" CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO`;
  }

  console.log('========================================');
  console.log('开始执行iOS打包命令');
  console.log('工作目录:', iosPath);
  console.log('打包命令:', buildCommand);
  console.log('Scheme:', schemeName);
  console.log('Archive路径:', archivePath);
  console.log('========================================');

  exec(buildCommand, { 
    cwd: iosPath,
    maxBuffer: 1024 * 1024 * 50, // 50MB buffer for large builds
    env: { ...process.env, TERM: 'xterm-color' }
  }, (error, stdout, stderr) => {
    const hasError = error !== null;
    
    console.log('========================================');
    if (hasError) {
      console.error('❌ iOS打包失败');
      console.error('错误代码:', error.code);
      console.error('错误信息:', error.message);
      console.error('标准错误输出:', stderr);
      console.error('标准输出:', stdout);
      console.log('========================================');
      // 打包失败，直接返回错误
      return callback(error, `打包失败:\n${stdout}\n${stderr}\n错误: ${error.message}`);
    } else {
      console.log('✅ iOS打包成功完成');
      console.log('构建输出:', stdout.substring(0, 500) + '...'); // 只显示前500字符
    }
    console.log('========================================');
    
    // 打包成功后，导出IPA文件
    if (!fs.existsSync(archivePath)) {
      return callback(new Error(`Archive文件不存在: ${archivePath}`));
    }
    
    console.log('开始导出IPA文件...');
    const exportDir = path.join(buildDir, 'export');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    
    // 创建ExportOptions.plist文件（用于导出IPA）
    const exportOptionsPath = path.join(buildDir, 'ExportOptions.plist');
    const exportOptionsContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>release-testing</string>
    <key>compileBitcode</key>
    <false/>
    <key>stripSwiftSymbols</key>
    <true/>
</dict>
</plist>`;
    
    fs.writeFileSync(exportOptionsPath, exportOptionsContent);
    
    // 执行导出IPA命令
    const exportCommand = `xcodebuild -exportArchive -archivePath "${archivePath}" -exportPath "${exportDir}" -exportOptionsPlist "${exportOptionsPath}"`;
    
    console.log('执行导出IPA命令:', exportCommand);
    
    exec(exportCommand, {
      cwd: iosPath,
      maxBuffer: 1024 * 1024 * 50,
      env: { ...process.env, TERM: 'xterm-color' }
    }, (exportError, exportStdout, exportStderr) => {
      const dateFolder = getDateFolderName();
      const outputDateDir = path.join(outputPath, dateFolder, 'ios');
      let copiedFiles = [];
      
      if (exportError) {
        console.error('导出IPA失败:', exportError);
        console.error('错误输出:', exportStderr);
        // 不复制Archive文件，只输出IPA
        return callback(exportError, `Archive创建成功，但导出IPA失败:\n${exportStdout}\n${exportStderr}\n错误: ${exportError.message}`);
      }
      
      console.log('✅ IPA导出成功');
      
      // 查找并复制IPA文件
      try {
        // 查找IPA文件
        const findIPAFiles = (dir) => {
          const files = [];
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isFile() && entry.name.endsWith('.ipa')) {
                files.push(fullPath);
              } else if (entry.isDirectory()) {
                files.push(...findIPAFiles(fullPath));
              }
            }
          } catch (error) {
            console.error('查找IPA文件时出错:', error);
          }
          return files;
        };
        
        const ipaFiles = findIPAFiles(exportDir);
        console.log(`找到 ${ipaFiles.length} 个IPA文件`);
        
        // 找到所有包含IPA文件的目录（去重）
        const ipaDirs = new Set();
        for (const ipaFile of ipaFiles) {
          const ipaDir = path.dirname(ipaFile);
          ipaDirs.add(ipaDir);
        }
        
        // 生成带时间戳的输出目录名（格式：Scheme YYYY-MM-DD HH-MM-SS）
        const iosOutputDirName = getIOSOutputDirName(schemeName);
        const outputDirPath = path.join(outputDateDir, iosOutputDirName);
        
        // 复制所有IPA文件到统一的输出目录
        // 如果只有一个IPA目录，直接复制；如果有多个，合并到一个目录
        let allCopied = false;
        for (const ipaDir of ipaDirs) {
          // 复制整个目录（保留目录结构和时间信息）
          const copyResult = copyToDestination(ipaDir, outputDirPath);
          if (copyResult.success) {
            allCopied = true;
            // 查找这个目录中的IPA文件
            const dirIpaFiles = ipaFiles.filter(f => path.dirname(f) === ipaDir);
            dirIpaFiles.forEach(ipaFile => {
              const ipaFileName = path.basename(ipaFile);
              copiedFiles.push(`IPA文件: ${ipaFileName}`);
            });
            console.log(`已复制IPA目录: ${iosOutputDirName}`);
          } else {
            console.error(`复制目录失败: ${iosOutputDirName} - ${copyResult.message}`);
          }
        }
        
        if (!allCopied) {
          console.error('复制IPA目录失败');
        }
        
        // 不复制Archive文件，只保留IPA文件
        
        // 构建输出消息
        let outputMsg = `\n✅ iOS打包成功完成！\n`;
        outputMsg += `📁 输出目录: ${outputDateDir}\n`;
        if (copiedFiles.length > 0) {
          outputMsg += `\n已复制 ${copiedFiles.length} 个文件：\n`;
          copiedFiles.forEach(file => {
            outputMsg += `  ✓ ${file}\n`;
          });
        } else {
          outputMsg += '\n⚠️ 警告: 未找到IPA或Archive文件\n';
        }
        callback(null, outputMsg);
      } catch (copyError) {
        console.error('复制iOS文件时出错:', copyError);
        callback(null, `\n⚠️ 打包成功，但复制文件时出错: ${copyError.message}`);
      }
    });
  });
}

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, 'config.json');

// 读取配置文件
function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('读取配置文件失败:', error);
  }
  // 返回默认配置
  return {
    projectBasePath: '',
    outputBasePath: '',
    projectPaths: [],
    outputPaths: [],
    gitPassphrase: '712712',
    larkWebhookUrl: ''
  };
}

// 保存配置文件
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('保存配置文件失败:', error);
    return false;
  }
}

// 发送 Lark 消息
function sendLarkMessage(webhookUrl, message, filePath = null) {
  return new Promise((resolve, reject) => {
    if (!webhookUrl || !webhookUrl.trim()) {
      resolve({ success: false, message: 'Lark Webhook URL 未配置' });
      return;
    }

    try {
      const url = new URL(webhookUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      
      // 如果有文件路径，构建包含文件信息的消息
      let messageContent = message;
      if (filePath && fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const fileSize = (stats.size / 1024 / 1024).toFixed(2); // MB
        const fileName = path.basename(filePath);
        messageContent += `\n\n📦 打包文件信息：\n`;
        messageContent += `文件名: ${fileName}\n`;
        messageContent += `文件大小: ${fileSize} MB\n`;
        messageContent += `文件路径: ${filePath}\n`;
        messageContent += `\n💡 提示: 文件已保存在服务器本地，请通过其他方式获取文件。`;
      }
      
      const postData = JSON.stringify({
        msg_type: 'text',
        content: {
          text: messageContent
        }
      });

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true, message: 'Lark 消息发送成功', data });
          } else {
            resolve({ success: false, message: `Lark 消息发送失败，状态码: ${res.statusCode}`, data });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ success: false, message: `Lark 消息发送失败: ${error.message}` });
      });

      req.write(postData);
      req.end();
    } catch (error) {
      resolve({ success: false, message: `Lark 消息发送失败: ${error.message}` });
    }
  });
}

// 获取本机 IP 地址
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // 跳过内部（即 127.0.0.1）和非 IPv4 地址
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({
          interface: name,
          address: iface.address
        });
      }
    }
  }
  
  return ips;
}

// 获取公网 IP 地址
function getPublicIP() {
  return new Promise((resolve, reject) => {
    // 使用多个服务获取公网 IP，提高成功率
    const services = [
      'https://api.ipify.org?format=json',
      'https://api.ip.sb/ip',
      'https://ifconfig.me/ip'
    ];
    
    let currentIndex = 0;
    
    const tryNext = () => {
      if (currentIndex >= services.length) {
        reject(new Error('无法获取公网 IP'));
        return;
      }
      
      const url = services[currentIndex];
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : http;
      
      const req = client.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            // 尝试解析 JSON
            const json = JSON.parse(data);
            resolve(json.ip || data.trim());
          } catch {
            // 如果不是 JSON，直接返回文本
            resolve(data.trim());
          }
        });
      });
      
      req.on('error', () => {
        currentIndex++;
        tryNext();
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        currentIndex++;
        tryNext();
      });
    };
    
    tryNext();
  });
}

// API路由：测试发送 Lark 消息
app.post('/api/lark/test', async (req, res) => {
  try {
    const { webhookUrl, message, filePath } = req.body;
    const testWebhookUrl = webhookUrl || 'https://open.larksuite.com/open-apis/bot/v2/hook/69a4732c-f817-4cdd-85aa-3cf2dd7cc562';
    const testMessage = message || '正在测试，主要来测试功能好不好使，好使的话';
    
    const result = await sendLarkMessage(testWebhookUrl, testMessage, filePath);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API路由：获取当前 IP 信息
app.get('/api/ip-info', async (req, res) => {
  try {
    const localIPs = getLocalIPs();
    let publicIP = null;
    
    try {
      publicIP = await getPublicIP();
    } catch (error) {
      console.error('获取公网 IP 失败:', error.message);
    }
    
    res.json({
      success: true,
      localIPs: localIPs,
      publicIP: publicIP,
      message: publicIP 
        ? `当前公网 IP: ${publicIP}` 
        : '无法获取公网 IP，请检查网络连接'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API路由：获取配置
app.get('/api/config', (req, res) => {
  try {
    const config = readConfig();
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API路由：更新配置
app.post('/api/config', (req, res) => {
  try {
    const { projectBasePath, outputBasePath, projectPaths, outputPaths, gitPassphrase, larkWebhookUrl } = req.body;
    // 读取现有配置，保留已有配置
    const existingConfig = readConfig();
    const config = {
      projectBasePath: projectBasePath !== undefined ? projectBasePath : existingConfig.projectBasePath,
      outputBasePath: outputBasePath !== undefined ? outputBasePath : existingConfig.outputBasePath,
      projectPaths: projectPaths !== undefined ? projectPaths : existingConfig.projectPaths,
      outputPaths: outputPaths !== undefined ? outputPaths : existingConfig.outputPaths,
      gitPassphrase: gitPassphrase !== undefined ? gitPassphrase : (existingConfig.gitPassphrase || '712712'),
      larkWebhookUrl: larkWebhookUrl !== undefined ? larkWebhookUrl : (existingConfig.larkWebhookUrl || '')
    };
    if (saveConfig(config)) {
      res.json({ success: true, message: '配置已保存' });
    } else {
      res.status(500).json({ success: false, error: '保存配置失败' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API路由：获取目录列表
app.get('/api/directories', (req, res) => {
  try {
    const { basePath } = req.query;
    
    if (!basePath) {
      return res.status(400).json({ success: false, error: '基础路径不能为空' });
    }

    if (!fs.existsSync(basePath)) {
      return res.status(400).json({ success: false, error: '路径不存在' });
    }

    const stat = fs.statSync(basePath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ success: false, error: '路径不是目录' });
    }

    // 读取目录下的所有子目录
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    const directories = entries
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        name: entry.name,
        path: path.join(basePath, entry.name),
        fullPath: path.join(basePath, entry.name)
      }));

    res.json({ 
      success: true, 
      directories: directories.sort((a, b) => a.name.localeCompare(b.name))
    });
  } catch (error) {
    console.error('获取目录列表失败:', error);
    res.status(500).json({ 
      success: false, 
      error: `获取目录列表失败: ${error.message}` 
    });
  }
});

// API路由：添加路径
app.post('/api/config/add-path', (req, res) => {
  try {
    const { type, path: newPath } = req.body;
    if (!type || !newPath) {
      return res.status(400).json({ success: false, error: '参数不完整' });
    }

    const config = readConfig();
    const pathKey = type === 'project' ? 'projectPaths' : 'outputPaths';
    
    // 如果路径已存在，不重复添加
    if (!config[pathKey].includes(newPath)) {
      config[pathKey].push(newPath);
      saveConfig(config);
    }

    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API路由：检查项目路径
app.post('/api/check-project', (req, res) => {
  try {
    const { projectPath } = req.body;
    
    if (!projectPath) {
      return res.status(400).json({ success: false, error: '项目路径不能为空' });
    }

    if (!fs.existsSync(projectPath)) {
      return res.status(400).json({ success: false, error: '项目路径不存在' });
    }

    // 检查是否是目录
    const stat = fs.statSync(projectPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ success: false, error: '项目路径必须是一个目录' });
    }

    const detectionResult = detectProjectType(projectPath);
    
    res.json({
      success: true,
      projectTypes: detectionResult.types,
      projectInfo: detectionResult.projectInfo,
      message: `检测到项目类型: ${detectionResult.types.join(', ') || '未检测到Android或iOS项目'}`
    });
  } catch (error) {
    console.error('检查项目时出错:', error);
    res.status(500).json({ 
      success: false, 
      error: `检查项目失败: ${error.message}` 
    });
  }
});

// 存储构建会话
const buildSessions = new Map();

// 修改 Android 项目的版本号
function updateAndroidVersion(androidPath, versionName, versionCode) {
  try {
    // 只查找 config.gradle 文件
    const configGradlePath = path.join(androidPath, 'config.gradle');
    
    if (!fs.existsSync(configGradlePath)) {
      return {
        success: false,
        message: '未找到 Android config.gradle 文件'
      };
    }
    
    let content = fs.readFileSync(configGradlePath, 'utf8');
    const originalContent = content;
    let modified = false;
    
    // 修改 ext.android.versionName
    // 格式: versionName : '1.1.0', 或 versionName: '1.1.0',
    if (versionName) {
      // 匹配 versionName : 'xxx', 或 versionName: 'xxx', 或 versionName : "xxx", 或 versionName: "xxx",
      const versionNamePattern = /(versionName\s*:\s*)(['"])([^'"]+)(['"]\s*,)/g;
      if (versionNamePattern.test(content)) {
        versionNamePattern.lastIndex = 0;
        content = content.replace(versionNamePattern, (match, p1, p2, p3, p4) => {
          // 保持原有的引号类型（单引号或双引号）
          return `${p1}${p2}${versionName}${p4}`;
        });
        modified = true;
      } else {
        return {
          success: false,
          message: '未找到 versionName 配置（格式应为: versionName : \'xxx\', 或 versionName: "xxx",）'
        };
      }
    }
    
    // 修改 ext.android.versionCode
    // 格式: versionCode : 10002, 或 versionCode: 10002,
    if (versionCode) {
      // 匹配 versionCode : 123, 或 versionCode: 123,
      const versionCodePattern = /(versionCode\s*:\s*)(\d+)(\s*,)/g;
      if (versionCodePattern.test(content)) {
        versionCodePattern.lastIndex = 0;
        content = content.replace(versionCodePattern, `$1${versionCode}$3`);
        modified = true;
      } else {
        return {
          success: false,
          message: '未找到 versionCode 配置（格式应为: versionCode : 123, 或 versionCode: 123,）'
        };
      }
    }
    
    if (modified && content !== originalContent) {
      fs.writeFileSync(configGradlePath, content, 'utf8');
      return {
        success: true,
        message: `已修改 Android 版本信息: config.gradle`,
        file: configGradlePath
      };
    } else {
      return {
        success: false,
        message: '未找到版本配置项或无需修改'
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `修改 Android 版本号失败: ${error.message}`
    };
  }
}

// 修改 iOS 项目的版本号
function updateIOSVersion(iosPath, versionName, versionCode) {
  try {
    // 查找 Info.plist 文件
    const infoPlistPaths = [
      path.join(iosPath, 'Info.plist'),
      path.join(iosPath, 'Runner', 'Info.plist'),
      path.join(iosPath, path.basename(iosPath), 'Info.plist')
    ];
    
    let infoPlistPath = null;
    for (const plistPath of infoPlistPaths) {
      if (fs.existsSync(plistPath)) {
        infoPlistPath = plistPath;
        break;
      }
    }
    
    if (!infoPlistPath) {
      // 尝试搜索所有 Info.plist 文件
      const searchInfoPlist = (dir) => {
        if (!fs.existsSync(dir)) return null;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile() && entry.name === 'Info.plist') {
            return fullPath;
          } else if (entry.isDirectory() && entry.name !== 'build' && entry.name !== '.git') {
            const found = searchInfoPlist(fullPath);
            if (found) return found;
          }
        }
        return null;
      };
      infoPlistPath = searchInfoPlist(iosPath);
    }
    
    if (!infoPlistPath) {
      return {
        success: false,
        message: '未找到 iOS Info.plist 文件'
      };
    }
    
    // 读取并解析 Info.plist
    let content = fs.readFileSync(infoPlistPath, 'utf8');
    const originalContent = content;
    let modified = false;
    
    // 修改 CFBundleShortVersionString (版本号)
    if (versionName) {
      const versionNamePattern = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/;
      if (versionNamePattern.test(content)) {
        content = content.replace(versionNamePattern, `<key>CFBundleShortVersionString</key>\n\t<string>${versionName}</string>`);
        modified = true;
      } else {
        // 如果没有找到，尝试添加
        const dictPattern = /(<dict>)/;
        if (dictPattern.test(content)) {
          content = content.replace(dictPattern, `$1\n\t<key>CFBundleShortVersionString</key>\n\t<string>${versionName}</string>`);
          modified = true;
        }
      }
    }
    
    // 修改 CFBundleVersion (Build 号)
    if (versionCode) {
      const versionCodePattern = /<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/;
      if (versionCodePattern.test(content)) {
        content = content.replace(versionCodePattern, `<key>CFBundleVersion</key>\n\t<string>${versionCode}</string>`);
        modified = true;
      } else {
        // 如果没有找到，尝试添加
        const dictPattern = /(<dict>)/;
        if (dictPattern.test(content)) {
          content = content.replace(dictPattern, `$1\n\t<key>CFBundleVersion</key>\n\t<string>${versionCode}</string>`);
          modified = true;
        }
      }
    }
    
    if (content !== originalContent) {
      fs.writeFileSync(infoPlistPath, content, 'utf8');
      return {
        success: true,
        message: `已修改 iOS 版本信息: ${path.relative(iosPath, infoPlistPath)}`,
        file: infoPlistPath
      };
    } else {
      return {
        success: false,
        message: '未找到 iOS 版本配置项'
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `修改 iOS 版本号失败: ${error.message}`
    };
  }
}

// 修改 Flutter 代码中的 JcEnv 配置
function updateFlutterJcEnv(flutterPath, envType) {
  try {
    // 常见的 Flutter 代码文件位置
    const possiblePaths = [
      path.join(flutterPath, 'lib', 'main.dart'),
      path.join(flutterPath, 'lib', 'config', 'env.dart'),
      path.join(flutterPath, 'lib', 'utils', 'env.dart'),
      path.join(flutterPath, 'lib', 'common', 'env.dart')
    ];
    
    // 搜索所有 Dart 文件
    const searchInDirectory = (dir, fileList = []) => {
      if (!fs.existsSync(dir)) return fileList;
      
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'build' && entry.name !== '.dart_tool') {
          searchInDirectory(fullPath, fileList);
        } else if (entry.isFile() && entry.name.endsWith('.dart')) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    };
    
    // 在所有 Dart 文件中搜索 JcEnv jcEnv = JcEnv
    const dartFiles = searchInDirectory(path.join(flutterPath, 'lib'));
    
    for (const filePath of dartFiles) {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        const originalContent = content;
        
        // 匹配 JcEnv jcEnv = JcEnv.test; 或 JcEnv jcEnv = JcEnv.prd;
        const pattern = /JcEnv\s+jcEnv\s*=\s*JcEnv\.(test|prd)\s*;/g;
        
        if (pattern.test(content)) {
          const targetEnv = envType === 'prd' ? 'prd' : 'test';
          content = content.replace(pattern, `JcEnv jcEnv = JcEnv.${targetEnv};`);
          
          if (content !== originalContent) {
            fs.writeFileSync(filePath, content, 'utf8');
            return { 
              success: true, 
              filePath: filePath,
              message: `已修改 ${path.relative(flutterPath, filePath)} 中的 JcEnv 为 ${targetEnv}`
            };
          }
        }
      } catch (error) {
        // 跳过无法读取的文件
        continue;
      }
    }
    
    return { success: false, message: '未找到 JcEnv jcEnv = JcEnv 配置' };
  } catch (error) {
    return { success: false, message: `修改 Flutter JcEnv 配置失败: ${error.message}` };
  }
}

// API路由：开始打包（返回会话ID）
app.post('/api/build/start', (req, res) => {
  const { projectPath, outputPath, buildType, envType, versionName, versionCode } = req.body;
  
  if (!projectPath) {
    return res.status(400).json({ error: '项目路径不能为空' });
  }

  if (!outputPath) {
    return res.status(400).json({ error: '输出包文件夹路径不能为空' });
  }

  if (!fs.existsSync(projectPath)) {
    return res.status(400).json({ error: '项目路径不存在' });
  }

  // 确保输出目录存在
  if (!fs.existsSync(outputPath)) {
    try {
      fs.mkdirSync(outputPath, { recursive: true });
    } catch (error) {
      return res.status(400).json({ error: `无法创建输出目录: ${error.message}` });
    }
  }

  if (!['android', 'ios', 'both'].includes(buildType)) {
    return res.status(400).json({ error: '无效的打包类型' });
  }

  // 创建会话ID（使用时间戳+随机数确保唯一性）
  const sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const session = {
    id: sessionId,
    projectPath,
    outputPath,
    buildType,
    envType: envType || 'test', // 环境类型，默认为 test
    versionName: versionName || '', // 版本号
    versionCode: versionCode || '', // Build 号
    status: 'building', // 初始状态为building，表示正在构建中
    logs: [],
    progress: 0, // 明确初始化进度为0
    results: {
      android: null,
      ios: null,
      errors: [],
      outputPath: null
    }
  };
  
  buildSessions.set(sessionId, session);

  // 异步开始打包
  startBuild(sessionId);

  res.json({ sessionId, message: '打包已开始' });
});

// API路由：获取构建进度（SSE）
app.get('/api/build/progress/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  // 设置SSE头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const session = buildSessions.get(sessionId);
  if (!session) {
    res.write(`data: ${JSON.stringify({ error: '会话不存在' })}\n\n`);
    res.end();
    return;
  }

  // 发送初始状态
  let lastLogCount = session.logs.length;
  res.write(`data: ${JSON.stringify({ 
    status: session.status, 
    logs: session.logs, // 发送所有已有日志
    results: session.results,
    progress: session.progress || 0
  })}\n\n`);
  
  // 定期发送更新
  const interval = setInterval(() => {
    const currentSession = buildSessions.get(sessionId);
    if (!currentSession) {
      clearInterval(interval);
      // 发送最后一条消息，告知会话已结束
      res.write(`data: ${JSON.stringify({ 
        status: 'completed',
        logs: [],
        results: {},
        progress: 100,
        message: '会话已结束'
      })}\n\n`);
      setTimeout(() => res.end(), 500);
      return;
    }

    // 只发送新日志
    const newLogs = currentSession.logs.slice(lastLogCount);
    lastLogCount = currentSession.logs.length;

    res.write(`data: ${JSON.stringify({ 
      status: currentSession.status, 
      logs: newLogs.length > 0 ? newLogs : [], // 只发送新日志
      results: currentSession.results,
      progress: currentSession.progress || 0
    })}\n\n`);

    // 如果完成，发送最后一条消息后关闭连接
    if (currentSession.status === 'completed' || currentSession.status === 'failed') {
      clearInterval(interval);
      // 发送最后一条完成消息
      res.write(`data: ${JSON.stringify({ 
        status: currentSession.status, 
        logs: [],
        results: currentSession.results,
        progress: 100,
        completed: true
      })}\n\n`);
      // 延迟关闭，确保前端能收到最后一条消息
      setTimeout(() => {
        res.end();
      }, 1000);
    }
  }, 200); // 每200ms更新一次，更流畅

  req.on('close', () => {
    clearInterval(interval);
  });
  
  // 处理客户端断开连接
  req.on('aborted', () => {
    clearInterval(interval);
  });
});

// Git拉取最新代码
function pullLatestCode(projectPath, sessionId, callback) {
  const session = buildSessions.get(sessionId);
  if (!session) return;

  function addLog(type, message) {
    const log = { type, message, timestamp: new Date().toISOString() };
    session.logs.push(log);
    console.log(`[${sessionId}] [${type}] ${message}`);
  }

  // 检查是否是git仓库
  const gitDir = path.join(projectPath, '.git');
  if (!fs.existsSync(gitDir)) {
    addLog('info', `路径不是Git仓库，跳过代码拉取: ${projectPath}`);
    return callback(null, `路径不是Git仓库: ${projectPath}`);
  }

  addLog('info', '开始拉取最新代码...');
  addLog('info', `Git仓库路径: ${projectPath}`);

  // 读取配置获取 Git passphrase
  const config = readConfig();
  const gitPassphrase = config.gitPassphrase || '712712';
  addLog('info', `已读取 Git passphrase 配置`);

  // 创建 expect 脚本来自动输入密码
  const expectScriptPath = path.join(__dirname, 'git-pull-expect.sh');
  const expectScriptContent = `#!/usr/bin/expect -f
set timeout 30
set passphrase "${gitPassphrase}"

spawn git pull
expect {
    "Enter passphrase for key" {
        send "$passphrase\\r"
        exp_continue
    }
    "passphrase for key" {
        send "$passphrase\\r"
        exp_continue
    }
    eof
}
`;

  try {
    fs.writeFileSync(expectScriptPath, expectScriptContent, { mode: 0o755 });
    addLog('info', '已创建 expect 脚本');
  } catch (error) {
    addLog('warning', `创建 expect 脚本失败: ${error.message}，将使用直接方式`);
  }

  // 使用 expect 脚本执行 git pull
  const gitProcess = spawn('/usr/bin/expect', ['-f', expectScriptPath], {
    cwd: projectPath,
    env: { 
      ...process.env, 
      TERM: 'xterm-color'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  gitProcess.stdout.on('data', (data) => {
    const text = data.toString();
    stdout += text;
    addLog('output', text);
  });

  gitProcess.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    addLog('error', text);
  });

  gitProcess.on('close', (code) => {
    // 清理 expect 脚本
    try {
      if (fs.existsSync(expectScriptPath)) {
        fs.unlinkSync(expectScriptPath);
        addLog('info', '已清理 expect 脚本');
      }
    } catch (error) {
      // 忽略清理错误
    }
    
    if (code !== 0) {
      addLog('error', `Git pull失败，退出代码: ${code}`);
      addLog('error', `错误输出: ${stderr}`);
      // Git pull失败不影响打包，继续执行
      addLog('warning', 'Git pull失败，但将继续执行打包');
      return callback(null, `Git pull失败，但将继续打包: ${stderr}`);
    }

    addLog('success', '代码拉取成功');
    addLog('info', `Git pull输出: ${stdout}`);
    callback(null, stdout);
  });

  gitProcess.on('error', (error) => {
    addLog('error', `执行git pull时出错: ${error.message}`);
    // Git pull出错不影响打包，继续执行
    addLog('warning', 'Git pull出错，但将继续执行打包');
    callback(null, `Git pull出错，但将继续打包: ${error.message}`);
  });
  
  // 确保 stdin 在进程结束时关闭
  gitProcess.on('exit', () => {
    if (gitProcess.stdin && !gitProcess.stdin.destroyed) {
      gitProcess.stdin.end();
    }
  });
}

// 开始构建
function startBuild(sessionId) {
  const session = buildSessions.get(sessionId);
  if (!session) return;

  // 重置会话状态，确保是全新的构建
  session.status = 'building';
  session.progress = 0;
  session.logs = [];
  session.results = {
    android: null,
    ios: null,
    errors: [],
    outputPath: null
  };

  const { projectPath, outputPath, buildType } = session;

  // 创建日期文件夹
  const dateFolder = getDateFolderName();
  const outputDateDir = path.join(outputPath, dateFolder);
  if (!fs.existsSync(outputDateDir)) {
    fs.mkdirSync(outputDateDir, { recursive: true });
  }
  session.results.outputPath = outputDateDir;

  function addLog(type, message) {
    const log = { type, message, timestamp: new Date().toISOString() };
    session.logs.push(log);
    console.log(`[${sessionId}] [${type}] ${message}`);
  }

  function updateProgress(progress) {
    session.progress = Math.min(100, Math.max(0, progress));
    // 立即更新状态，确保SSE能及时发送
    session.status = 'building';
  }

  let completed = 0;
  const total = buildType === 'both' ? 2 : 1;

  function checkComplete() {
    completed++;
    const progressPercent = Math.round((completed / total) * 100);
    updateProgress(progressPercent);
    
    if (completed === total) {
      // 检查是否有实际的打包错误（只检查 Android 和 iOS 打包是否成功）
      const hasAndroidError = session.results.android && !session.results.android.success;
      const hasIOSError = session.results.ios && !session.results.ios.success;
      
      // 只检查实际的打包错误，忽略其他非关键错误
      const hasError = hasAndroidError || hasIOSError;
      
      // 如果有错误，输出详细的错误信息
      if (hasError) {
        addLog('error', `打包失败详情:`);
        if (hasAndroidError && session.results.android) {
          addLog('error', `Android: ${session.results.android.output || '未知错误'}`);
        }
        if (hasIOSError && session.results.ios) {
          addLog('error', `iOS: ${session.results.ios.output || '未知错误'}`);
        }
        // 输出 errors 数组中的错误（如果有）
        if (session.results.errors.length > 0) {
          session.results.errors.forEach(err => {
            addLog('error', `${err.type}: ${err.error}`);
          });
        }
      } else if (session.results.errors.length > 0) {
        // 如果有非关键错误，只记录为警告
        addLog('warning', `打包过程中有一些警告:`);
        session.results.errors.forEach(err => {
          addLog('warning', `${err.type}: ${err.error}`);
        });
      }
      
      session.status = hasError ? 'failed' : 'completed';
      updateProgress(100);
      addLog(hasError ? 'error' : 'success', hasError ? '打包过程中出现错误' : `打包完成，文件已保存到: ${outputDateDir}`);
      
      // 如果打包成功，发送 Lark 消息
      if (!hasError) {
        const config = readConfig();
        if (config.larkWebhookUrl && config.larkWebhookUrl.trim()) {
          // 获取项目目录的最后一级子目录名称（例如：2-coinvex）
          const projectDirName = path.basename(projectPath);
          
          // 构建消息内容
          let message = `${projectDirName} 项目打包成功\n\n`;
          
          // 添加打包成功信息
          if (session.results.android && session.results.android.success) {
            message += `✅ Android 打包成功\n`;
            // 从输出信息中提取关键信息
            const androidOutput = session.results.android.output || '';
            // 提取文件数量等信息
            const fileMatch = androidOutput.match(/(\d+)\s*个文件/);
            if (fileMatch) {
              message += `   已生成 ${fileMatch[1]} 个文件\n`;
            }
            // 提取 APK/AAB 信息
            const apkMatch = androidOutput.match(/APK[^:]*:\s*(\d+)\s*个文件/);
            const aabMatch = androidOutput.match(/AAB[^:]*:\s*(\d+)\s*个文件/);
            if (apkMatch) {
              message += `   APK: ${apkMatch[1]} 个文件\n`;
            }
            if (aabMatch) {
              message += `   AAB: ${aabMatch[1]} 个文件\n`;
            }
          }
          
          if (session.results.ios && session.results.ios.success) {
            message += `✅ iOS 打包成功\n`;
            // 从输出信息中提取关键信息
            const iosOutput = session.results.ios.output || '';
            // 提取文件数量等信息
            const fileMatch = iosOutput.match(/(\d+)\s*个文件/);
            if (fileMatch) {
              message += `   已生成 ${fileMatch[1]} 个文件\n`;
            }
            // 提取 IPA 信息
            const ipaMatch = iosOutput.match(/IPA[^:]*:\s*(\d+)\s*个文件/);
            if (ipaMatch) {
              message += `   IPA: ${ipaMatch[1]} 个文件\n`;
            }
          }
          
          message += `\n📁 输出路径: ${outputDateDir}\n`;
          message += `📅 打包时间: ${new Date().toLocaleString('zh-CN')}\n`;
          
          // 查找 APK 文件
          let apkFilePath = null;
          if (session.results.android && session.results.android.success) {
            // 查找 APK 文件
            const androidOutputDir = path.join(outputDateDir, 'android');
            const apkDirs = [
              path.join(androidOutputDir, 'apk', 'JcApk', 'release'),
              path.join(androidOutputDir, 'apk', 'release')
            ];
            
            for (const apkDir of apkDirs) {
              if (fs.existsSync(apkDir)) {
                try {
                  const files = fs.readdirSync(apkDir).filter(f => f.endsWith('.apk'));
                  if (files.length > 0) {
                    // 获取最新的 APK 文件（按修改时间排序）
                    const apkFiles = files.map(f => ({
                      name: f,
                      path: path.join(apkDir, f),
                      mtime: fs.statSync(path.join(apkDir, f)).mtime
                    })).sort((a, b) => b.mtime - a.mtime);
                    
                    if (apkFiles.length > 0) {
                      apkFilePath = apkFiles[0].path;
                      break;
                    }
                  }
                } catch (error) {
                  addLog('warning', `查找 APK 文件时出错: ${error.message}`);
                }
              }
            }
          }
          
          // 异步发送消息，不阻塞主流程
          sendLarkMessage(config.larkWebhookUrl, message, apkFilePath).then(result => {
            if (result.success) {
              addLog('info', 'Lark 消息发送成功');
            } else {
              addLog('warning', `Lark 消息发送失败: ${result.message}`);
            }
          }).catch(error => {
            addLog('warning', `Lark 消息发送异常: ${error.message}`);
          });
        } else {
          addLog('info', 'Lark Webhook URL 未配置，跳过消息发送');
        }
      }
      
      // 5分钟后清理会话
      setTimeout(() => {
        buildSessions.delete(sessionId);
      }, 5 * 60 * 1000);
    }
  }
  
  // 初始化进度和状态
  updateProgress(0);
  session.status = 'building';

  // 检测Flutter项目
  const detectionResult = detectProjectType(projectPath);
  const flutterPath = detectionResult.projectInfo.flutter 
    ? path.join(projectPath, detectionResult.projectInfo.flutter)
    : null;
  
  // 查找iOS项目目录（如果需要打包iOS）
  const iosDirName = (buildType === 'ios' || buildType === 'both') 
    ? findIOSDirectory(projectPath) 
    : null;
  const iosPath = iosDirName ? path.join(projectPath, iosDirName) : null;
  
  // 查找Android项目目录（如果需要打包Android）
  const androidDirName = (buildType === 'android' || buildType === 'both') 
    ? findAndroidDirectory(projectPath) 
    : null;
  const androidPath = androidDirName ? path.join(projectPath, androidDirName) : null;

  // 先拉取最新代码，然后再开始打包
  addLog('info', '准备开始打包，先拉取最新代码...');
  
  // 如果有Flutter项目，先拉取Flutter代码
  if (flutterPath) {
    addLog('info', `检测到Flutter项目: ${detectionResult.projectInfo.flutter}，先拉取Flutter代码...`);
    pullLatestCode(flutterPath, sessionId, (error, output) => {
      if (error) {
        addLog('error', `拉取Flutter代码时出错: ${error.message}`);
        // 即使拉取失败，也继续打包
      } else {
        addLog('success', 'Flutter代码拉取完成');
      }
      
      // Flutter 代码拉取完成后，修改 JcEnv 配置
      if (session.envType) {
        addLog('info', `开始修改 Flutter JcEnv 配置为: ${session.envType === 'prd' ? '生产发布' : '测试'}`);
        const updateResult = updateFlutterJcEnv(flutterPath, session.envType);
        if (updateResult.success) {
          addLog('success', updateResult.message);
        } else {
          addLog('warning', updateResult.message);
        }
      }
      
      // 拉取平台代码的函数
      const pullPlatformCode = () => {
        // 如果需要打包iOS，先拉取iOS代码
        if (iosPath) {
          addLog('info', `开始拉取iOS代码: ${iosPath}`);
          pullLatestCode(iosPath, sessionId, (error, output) => {
            if (error) {
              addLog('error', `拉取iOS代码时出错: ${error.message}`);
              // 即使拉取失败，也继续打包
            } else {
              addLog('success', 'iOS代码拉取完成');
            }
            
            // iOS代码拉取完成后，如果需要打包Android，拉取Android代码
            if (androidPath) {
              addLog('info', `开始拉取Android代码: ${androidPath}`);
              pullLatestCode(androidPath, sessionId, (error, output) => {
                if (error) {
                  addLog('error', `拉取Android代码时出错: ${error.message}`);
                  // 即使拉取失败，也继续打包
                } else {
                  addLog('success', 'Android代码拉取完成');
                }
                
                addLog('info', '代码拉取完成，开始打包...');
                updateProgress(10); // Git pull完成后，进度设为10%
                startActualBuild();
              });
            } else {
              // 不需要打包Android，直接开始打包
              addLog('info', '代码拉取完成，开始打包...');
              updateProgress(10); // Git pull完成后，进度设为10%
              startActualBuild();
            }
          });
        } else if (androidPath) {
          // 不需要打包iOS，但需要打包Android，拉取Android代码
          addLog('info', `开始拉取Android代码: ${androidPath}`);
          pullLatestCode(androidPath, sessionId, (error, output) => {
            if (error) {
              addLog('error', `拉取Android代码时出错: ${error.message}`);
              // 即使拉取失败，也继续打包
            } else {
              addLog('success', 'Android代码拉取完成');
            }
            
            addLog('info', '代码拉取完成，开始打包...');
            updateProgress(10); // Git pull完成后，进度设为10%
            startActualBuild();
          });
        } else {
          // 不需要打包iOS和Android，拉取项目根目录代码（如果项目根目录也是git仓库）
          addLog('info', `开始拉取项目根目录代码: ${projectPath}`);
          pullLatestCode(projectPath, sessionId, (error, output) => {
            if (error) {
              addLog('error', `拉取项目根目录代码时出错: ${error.message}`);
              // 即使拉取失败，也继续打包
            }
            
            addLog('info', '代码拉取完成，开始打包...');
            updateProgress(10); // Git pull完成后，进度设为10%
            startActualBuild();
          });
        }
      };
      
      pullPlatformCode();
    });
  } else {
    // 没有Flutter项目
    // 拉取平台代码的函数
    const pullPlatformCode = () => {
      // 如果需要打包iOS，先拉取iOS代码
      if (iosPath) {
        addLog('info', `开始拉取iOS代码: ${iosPath}`);
        pullLatestCode(iosPath, sessionId, (error, output) => {
          if (error) {
            addLog('error', `拉取iOS代码时出错: ${error.message}`);
            // 即使拉取失败，也继续打包
          } else {
            addLog('success', 'iOS代码拉取完成');
          }
          
          // iOS代码拉取完成后，如果需要打包Android，拉取Android代码
          if (androidPath) {
            addLog('info', `开始拉取Android代码: ${androidPath}`);
            pullLatestCode(androidPath, sessionId, (error, output) => {
              if (error) {
                addLog('error', `拉取Android代码时出错: ${error.message}`);
                // 即使拉取失败，也继续打包
              } else {
                addLog('success', 'Android代码拉取完成');
              }
              
              addLog('info', '代码拉取完成，开始打包...');
              updateProgress(10); // Git pull完成后，进度设为10%
              startActualBuild();
            });
          } else {
            // 不需要打包Android，直接开始打包
            addLog('info', '代码拉取完成，开始打包...');
            updateProgress(10); // Git pull完成后，进度设为10%
            startActualBuild();
          }
        });
      } else if (androidPath) {
        // 不需要打包iOS，但需要打包Android，拉取Android代码
        addLog('info', `开始拉取Android代码: ${androidPath}`);
        pullLatestCode(androidPath, sessionId, (error, output) => {
          if (error) {
            addLog('error', `拉取Android代码时出错: ${error.message}`);
            // 即使拉取失败，也继续打包
          } else {
            addLog('success', 'Android代码拉取完成');
          }
          
          addLog('info', '代码拉取完成，开始打包...');
          updateProgress(10); // Git pull完成后，进度设为10%
          startActualBuild();
        });
      } else {
        // 不需要打包iOS和Android，直接拉取项目根目录代码
        addLog('info', `开始拉取项目代码: ${projectPath}`);
        pullLatestCode(projectPath, sessionId, (error, output) => {
          if (error) {
            addLog('error', `拉取代码时出错: ${error.message}`);
            // 即使拉取失败，也继续打包
          }
          
          addLog('info', '代码拉取完成，开始打包...');
          updateProgress(10); // Git pull完成后，进度设为10%
          startActualBuild();
        });
      }
    };
    
    pullPlatformCode();
  }
  
  // 将实际的打包逻辑提取到单独的函数中
  function startActualBuild() {
    // 修改版本号（如果需要）
    if (session.versionName || session.versionCode) {
      // 修改 Android 版本号
      if ((buildType === 'android' || buildType === 'both') && androidPath) {
        addLog('info', '开始修改 Android 版本号...');
        const androidResult = updateAndroidVersion(androidPath, session.versionName, session.versionCode);
        if (androidResult.success) {
          addLog('success', androidResult.message);
        } else {
          addLog('warning', androidResult.message);
        }
      }
      
      // 修改 iOS 版本号
      if ((buildType === 'ios' || buildType === 'both') && iosPath) {
        addLog('info', '开始修改 iOS 版本号...');
        const iosResult = updateIOSVersion(iosPath, session.versionName, session.versionCode);
        if (iosResult.success) {
          addLog('success', iosResult.message);
        } else {
          addLog('warning', iosResult.message);
        }
      }
    }

    // Android打包
    if (buildType === 'android' || buildType === 'both') {
      addLog('info', '开始Android打包...');
      updateProgress(20); // Android打包开始，进度设为20%
      buildAndroidWithProgress(projectPath, outputPath, sessionId, (error, output) => {
        if (error) {
          session.results.errors.push({ type: 'android', error: error.message });
          session.results.android = { success: false, output: output || error.message };
          addLog('error', `Android打包失败: ${error.message}`);
        } else {
          session.results.android = { success: true, output: output };
          addLog('success', 'Android打包成功');
        }
        checkComplete();
      });
    }

    // iOS打包
    if (buildType === 'ios' || buildType === 'both') {
      addLog('info', '开始iOS打包...');
      // 如果是both，iOS进度从50%开始；如果只是iOS，从20%开始
      const iosStartProgress = buildType === 'both' ? 50 : 20;
      updateProgress(iosStartProgress);
      buildIOSWithProgress(projectPath, outputPath, sessionId, (error, output) => {
        if (error) {
          session.results.errors.push({ type: 'ios', error: error.message });
          session.results.ios = { success: false, output: output || error.message };
          addLog('error', `iOS打包失败: ${error.message}`);
        } else {
          session.results.ios = { success: true, output: output };
          addLog('success', 'iOS打包成功');
        }
        checkComplete();
      });
    }
  }
}

// 兼容旧API
app.post('/api/build', (req, res) => {
  const { projectPath, outputPath, buildType } = req.body;
  
  // 创建会话并立即开始
  const sessionId = Date.now().toString();
  const session = {
    id: sessionId,
    projectPath,
    outputPath,
    buildType,
    status: 'running',
    logs: [],
    results: {
      android: null,
      ios: null,
      errors: [],
      outputPath: null
    }
  };
  
  buildSessions.set(sessionId, session);
  startBuild(sessionId);

  // 等待完成
  const checkInterval = setInterval(() => {
    const currentSession = buildSessions.get(sessionId);
    if (currentSession && (currentSession.status === 'completed' || currentSession.status === 'failed')) {
      clearInterval(checkInterval);
      const hasError = currentSession.results.errors.length > 0;
      res.json({
        success: !hasError,
        results: currentSession.results,
        message: hasError ? '打包过程中出现错误' : `打包完成，文件已保存到: ${currentSession.results.outputPath}`
      });
      buildSessions.delete(sessionId);
    }
  }, 500);
});

// API路由：重启服务器
app.post('/api/restart', (req, res) => {
  console.log('收到重启服务器请求');
  
  // 先返回响应，避免连接中断
  res.json({ 
    success: true, 
    message: '正在重启服务器，请稍候3-5秒后刷新页面...' 
  });
  
  // 延迟执行重启，确保响应已发送
  setTimeout(() => {
    const projectPath = __dirname; // 当前项目目录
    const restartCmd = `pkill -f "node server.js" && sleep 1 && cd "${projectPath}" && npm start`;
    
    console.log('执行重启命令:', restartCmd);
    
    // 在后台执行重启命令（使用detached和stdio: 'ignore'让进程独立运行）
    const restartProcess = spawn('sh', ['-c', restartCmd], {
      detached: true,
      stdio: 'ignore'
    });
    
    restartProcess.unref(); // 让父进程可以退出
    
    // 3秒后退出当前进程（给重启命令执行时间）
    setTimeout(() => {
      console.log('正在退出当前进程...');
      process.exit(0);
    }, 3000);
  }, 100);
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ 
    success: false, 
    error: err.message || '服务器内部错误' 
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`打包工具服务器运行在 http://localhost:${PORT}`);
  console.log('请在浏览器中打开该地址使用打包工具');
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请使用其他端口或关闭占用该端口的程序`);
  } else {
    console.error('服务器启动失败:', err);
  }
  process.exit(1);
});

