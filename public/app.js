const API_BASE = 'http://localhost:3000/api';

// DOM元素
const projectPathInput = document.getElementById('projectPath');
const outputPathInput = document.getElementById('outputPath');
const browseBtn = document.getElementById('browseBtn');
const browseOutputBtn = document.getElementById('browseOutputBtn');
const checkBtn = document.getElementById('checkBtn');
const buildBtn = document.getElementById('buildBtn');
const restartBtn = document.getElementById('restartBtn');
const configBtn = document.getElementById('configBtn');
const projectInfo = document.getElementById('projectInfo');
const projectTypes = document.getElementById('projectTypes');
const outputCard = document.getElementById('outputCard');
const output = document.getElementById('output');

let currentProjectTypes = [];
let currentProjectInfo = {};

// 检查项目
async function checkProject() {
    const projectPath = projectPathInput.value.trim();
    
    if (!projectPath) {
        alert('请输入项目路径');
        return;
    }

    checkBtn.disabled = true;
    checkBtn.textContent = '检查中...';

    try {
        const response = await fetch(`${API_BASE}/check-project`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ projectPath }),
        });

        // 检查响应状态
        if (!response.ok) {
            const errorText = await response.text();
            let errorMsg = `HTTP错误 ${response.status}`;
            try {
                const errorData = JSON.parse(errorText);
                errorMsg = errorData.error || errorMsg;
            } catch {
                errorMsg = errorText || errorMsg;
            }
            throw new Error(errorMsg);
        }

        const data = await response.json();

        if (data.success) {
            currentProjectTypes = data.projectTypes;
            currentProjectInfo = data.projectInfo || {};
            displayProjectInfo(data.projectTypes, data.projectInfo);
            buildBtn.disabled = false;
        } else {
            alert('检查失败: ' + (data.error || '未知错误'));
            projectInfo.classList.add('hidden');
            buildBtn.disabled = true;
        }
    } catch (error) {
        console.error('检查项目错误:', error);
        let errorMessage = error.message;
        if (error.message === 'Failed to fetch' || error.message === 'Load failed') {
            errorMessage = '无法连接到服务器，请确保服务器正在运行（npm start）';
        }
        alert('检查项目时出错: ' + errorMessage);
        projectInfo.classList.add('hidden');
        buildBtn.disabled = true;
    } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = '检查项目';
    }
}

// 显示项目信息
function displayProjectInfo(types, projectInfoData = {}) {
    projectInfo.classList.remove('hidden');
    projectTypes.innerHTML = '';

    if (types.length === 0) {
        projectTypes.innerHTML = '<p style="color: #f48771;">未检测到Android、iOS或Flutter项目</p>';
        return;
    }

    types.forEach(type => {
        const badge = document.createElement('span');
        badge.className = `project-type-badge ${type}`;
        let text = type.toUpperCase();
        // 显示目录名称
        if (projectInfoData[type]) {
            text += ` (${projectInfoData[type]})`;
        }
        badge.textContent = text;
        projectTypes.appendChild(badge);
    });
}

// 开始打包
async function startBuild() {
    const projectPath = projectPathInput.value.trim();
    const outputPath = outputPathInput.value.trim();
    const buildType = document.querySelector('input[name="buildType"]:checked').value;

    if (!projectPath) {
        alert('请输入项目路径');
        return;
    }

    if (!outputPath) {
        alert('请输入输出包文件夹路径');
        return;
    }

    // 如果选择了both但只检测到一种类型，给出提示
    if (buildType === 'both' && currentProjectTypes.length < 2) {
        if (!confirm(`当前项目只检测到 ${currentProjectTypes.join(', ')}，是否继续打包？`)) {
            return;
        }
    }

    // 如果选择了特定类型但未检测到，给出提示
    if (buildType !== 'both' && !currentProjectTypes.includes(buildType)) {
        if (!confirm(`当前项目未检测到 ${buildType} 项目，是否继续尝试打包？`)) {
            return;
        }
    }

    buildBtn.disabled = true;
    buildBtn.textContent = '打包中...';
    outputCard.style.display = 'block';
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    // 重置所有状态
    progressBar.style.display = 'block';
    progressFill.style.width = '0%';
    progressFill.style.background = 'linear-gradient(90deg, #4ec9b0 0%, #3ddc84 100%)';
    progressText.textContent = '正在启动打包...';
    output.innerHTML = '<div class="info">🚀 开始打包，请稍候...</div>';

    let sessionId = null;
    let eventSource = null;
    let isFirstMessage = true; // 标记是否是第一条消息

    try {
        // 启动打包
        const startResponse = await fetch(`${API_BASE}/build/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ projectPath, outputPath, buildType }),
        });

        if (!startResponse.ok) {
            throw new Error('启动打包失败');
        }

        const startData = await startResponse.json();
        sessionId = startData.sessionId;

        // 使用SSE获取实时进度
        eventSource = new EventSource(`${API_BASE}/build/progress/${sessionId}`);
        
        let lastLogCount = 0;
        let progress = 0;

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // 如果是第一条消息且状态已经是completed/failed，说明是旧会话，忽略
                if (isFirstMessage) {
                    isFirstMessage = false;
                    if (data.status === 'completed' || data.status === 'failed') {
                        console.warn('收到旧会话的完成状态，忽略');
                        return;
                    }
                }
                
                // 更新进度条
                if (data.progress !== undefined) {
                    progress = data.progress;
                    progressFill.style.width = progress + '%';
                }
                
                if (data.status === 'building' || data.status === 'running') {
                    progressText.textContent = `打包中... ${Math.round(progress)}%`;
                } else if (data.status === 'completed') {
                    progressFill.style.width = '100%';
                    progressFill.style.background = 'linear-gradient(90deg, #4ec9b0 0%, #3ddc84 100%)';
                    progressText.textContent = '✅ 打包完成！';
                } else if (data.status === 'failed') {
                    progressFill.style.width = '100%';
                    progressFill.style.background = '#f48771';
                    progressText.textContent = '❌ 打包失败';
                }

                // 显示新日志
                if (data.logs && data.logs.length > 0) {
                    const newLogs = data.logs.slice(lastLogCount);
                    newLogs.forEach(log => {
                        const logClass = log.type === 'error' ? 'error' : 
                                       log.type === 'success' ? 'success' : 
                                       log.type === 'output' ? 'info' : 'info';
                        output.innerHTML += `<div class="${logClass}">${escapeHtml(log.message)}</div>`;
                    });
                    output.scrollTop = output.scrollHeight;
                    lastLogCount = data.logs.length;
                }

                // 如果完成，显示最终结果
                if (data.status === 'completed' || data.status === 'failed') {
                    eventSource.close();
                    displayBuildResults({
                        success: data.status === 'completed',
                        results: data.results,
                        message: data.status === 'completed' ? '打包完成' : '打包失败'
                    });
                    buildBtn.disabled = false;
                    buildBtn.textContent = '开始打包';
                }
            } catch (error) {
                console.error('解析进度数据失败:', error);
            }
        };

        eventSource.onerror = (error) => {
            console.error('SSE连接错误:', error);
            eventSource.close();
            output.innerHTML += '<div class="error">❌ 连接中断，请检查服务器状态</div>';
            buildBtn.disabled = false;
            buildBtn.textContent = '开始打包';
        };

    } catch (error) {
        console.error('打包错误:', error);
        output.innerHTML += `<div class="error">❌ 打包请求失败: ${error.message}</div>`;
        if (eventSource) eventSource.close();
        buildBtn.disabled = false;
        buildBtn.textContent = '开始打包';
        progressBar.style.display = 'none';
    }
}

// 显示打包结果
function displayBuildResults(data) {
    output.innerHTML = '';

    if (data.success) {
        output.innerHTML += '<div class="success">✅ 打包完成！</div>';
        if (data.results.outputPath) {
            output.innerHTML += `<div class="success">📁 输出路径: ${escapeHtml(data.results.outputPath)}</div>`;
        }
    } else {
        output.innerHTML += '<div class="error">❌ 打包过程中出现错误</div>';
    }

    if (data.message) {
        output.innerHTML += `<div class="info">${escapeHtml(data.message)}</div>`;
    }

    if (data.results.android) {
        output.innerHTML += '<div class="info">\n📱 Android 打包结果：</div>';
        if (data.results.android.success) {
            output.innerHTML += `<div class="success">${escapeHtml(data.results.android.output)}</div>`;
        } else {
            output.innerHTML += `<div class="error">${escapeHtml(data.results.android.output)}</div>`;
        }
    }

    if (data.results.ios) {
        output.innerHTML += '<div class="info">\n🍎 iOS 打包结果：</div>';
        if (data.results.ios.success) {
            output.innerHTML += `<div class="success">${escapeHtml(data.results.ios.output)}</div>`;
        } else {
            output.innerHTML += `<div class="error">${escapeHtml(data.results.ios.output)}</div>`;
        }
    }

    // 滚动到底部
    output.scrollTop = output.scrollHeight;
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 显示路径选择对话框
async function showPathSelector(type, currentValue) {
    try {
        // 获取配置
        const response = await fetch(`${API_BASE}/config`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error('获取配置失败');
        }

        const config = data.config;
        // 对于输出路径，使用固定的output目录路径
        const basePath = type === 'project' 
            ? config.projectBasePath 
            : '/Users/chaiweidong/Desktop/jucom-work/tool/打包工具/output';
        const paths = type === 'project' ? config.projectPaths : config.outputPaths;
        const title = type === 'project' ? '选择项目路径' : '选择输出包文件夹路径';
        const placeholder = type === 'project' 
            ? '请输入或选择项目路径' 
            : '请输入或选择输出包文件夹路径';

        // 创建模态框
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 12px;
            max-width: 700px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        `;
        
        let directoriesHtml = '';
        let directories = [];
        
        // 如果有基础路径，获取子目录列表
        if (basePath) {
            try {
                const dirResponse = await fetch(`${API_BASE}/directories?basePath=${encodeURIComponent(basePath)}`);
                const dirData = await dirResponse.json();
                
                if (dirData.success && dirData.directories.length > 0) {
                    directories = dirData.directories;
                    directoriesHtml = `
                        <div style="margin-bottom: 20px;">
                            <label style="display: block; margin-bottom: 10px; font-weight: 600; color: #555;">
                                基础路径: <span style="font-family: monospace; font-size: 12px; color: #667eea;">${escapeHtml(basePath)}</span>
                            </label>
                            <label style="display: block; margin-bottom: 10px; font-weight: 600; color: #555;">选择子目录：</label>
                            <div style="max-height: 250px; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 6px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; padding: 10px;">
                                ${directories.map((dir) => {
                                    const escapedPath = dir.fullPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                                    return `
                                    <div style="padding: 12px; background: #f8f9ff; border: 2px solid #e0e0e0; border-radius: 6px; cursor: pointer; transition: all 0.2s; text-align: center;" 
                                         onmouseover="this.style.background='#667eea'; this.style.color='white'; this.style.borderColor='#667eea'" 
                                         onmouseout="this.style.background='#f8f9ff'; this.style.color='inherit'; this.style.borderColor='#e0e0e0'"
                                         onclick="selectDirectory('${escapedPath}')">
                                        <div style="font-weight: 600; font-size: 14px;">📁 ${escapeHtml(dir.name)}</div>
                                        <div style="font-size: 11px; color: #999; margin-top: 4px; word-break: break-all;">${escapeHtml(dir.path)}</div>
                                    </div>
                                `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }
            } catch (error) {
                console.error('获取目录列表失败:', error);
            }
        }
        
        let pathsHtml = '';
        if (paths.length > 0) {
            pathsHtml = `
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 10px; font-weight: 600; color: #555;">已保存的完整路径：</label>
                    <div style="max-height: 200px; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 6px;">
                        ${paths.map((p, index) => {
                            const escapedPath = p.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                            return `
                            <div style="padding: 12px; border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: background 0.2s;" 
                                 onmouseover="this.style.background='#f8f9ff'" 
                                 onmouseout="this.style.background='white'"
                                 onclick="selectPath('${escapedPath}')">
                                <div style="font-weight: 600; color: #667eea; margin-bottom: 4px;">📁 ${escapeHtml(p)}</div>
                            </div>
                        `;
                        }).join('')}
                    </div>
                </div>
            `;
        }
        
        modalContent.innerHTML = `
            <h2 style="color: #667eea; margin-bottom: 20px;">${title}</h2>
            ${directoriesHtml}
            ${pathsHtml}
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="cancelPathBtn" style="padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">取消</button>
            </div>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        // 选择子目录函数
        window.selectDirectory = (fullPath) => {
            // 自动选择
            if (type === 'project') {
                projectPathInput.value = fullPath;
            } else {
                outputPathInput.value = fullPath;
            }
            document.body.removeChild(modal);
        };
        
        // 选择路径函数
        window.selectPath = (path) => {
            // 自动选择
            if (type === 'project') {
                projectPathInput.value = path;
            } else {
                outputPathInput.value = path;
            }
            document.body.removeChild(modal);
        };
        
        // 取消
        document.getElementById('cancelPathBtn').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        // 点击外部关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
        
    } catch (error) {
        console.error('显示路径选择器失败:', error);
        // 降级到简单的prompt
        const path = prompt(`请输入${type === 'project' ? '项目' : '输出包文件夹'}路径:`);
        if (path) {
            if (type === 'project') {
                projectPathInput.value = path;
            } else {
                outputPathInput.value = path;
            }
        }
    }
}

// 浏览文件夹
browseBtn.addEventListener('click', () => {
    showPathSelector('project', projectPathInput.value);
});

browseOutputBtn.addEventListener('click', () => {
    showPathSelector('output', outputPathInput.value);
});

// 支持拖拽文件夹
projectPathInput.addEventListener('dragover', (e) => {
    e.preventDefault();
    projectPathInput.style.borderColor = '#667eea';
});

projectPathInput.addEventListener('dragleave', () => {
    projectPathInput.style.borderColor = '#e0e0e0';
});

projectPathInput.addEventListener('drop', (e) => {
    e.preventDefault();
    projectPathInput.style.borderColor = '#e0e0e0';
    
    // 注意：浏览器安全限制，无法直接获取文件夹路径
    // 这里提示用户手动输入
    alert('由于浏览器安全限制，请手动输入项目路径。\n或者您可以将文件夹路径复制后粘贴到输入框。');
});

// 路径配置管理
configBtn.addEventListener('click', async () => {
    try {
        const response = await fetch(`${API_BASE}/config`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error('获取配置失败');
        }

        const config = data.config;

        // 创建配置管理模态框
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 12px;
            max-width: 700px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        `;
        
        modalContent.innerHTML = `
            <h2 style="color: #667eea; margin-bottom: 20px;">⚙️ 路径配置管理</h2>
            
            <div style="margin-bottom: 30px;">
                <h3 style="color: #555; margin-bottom: 15px;">项目路径列表</h3>
                <div id="projectPathsList" style="margin-bottom: 15px;">
                    ${config.projectPaths.map((p, index) => `
                        <div style="display: flex; align-items: center; padding: 10px; background: #f8f9ff; border-radius: 6px; margin-bottom: 8px;">
                            <span style="flex: 1; font-family: monospace; font-size: 13px;">${escapeHtml(p)}</span>
                            <button onclick="deletePath('project', ${index})" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">删除</button>
                        </div>
                    `).join('') || '<p style="color: #999; font-style: italic;">暂无保存的项目路径</p>'}
                </div>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="newProjectPath" placeholder="输入新项目路径" style="flex: 1; padding: 10px; border: 2px solid #e0e0e0; border-radius: 6px;">
                    <button onclick="addPath('project')" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">添加</button>
                </div>
            </div>
            
            <div style="margin-bottom: 30px;">
                <h3 style="color: #555; margin-bottom: 15px;">输出包文件夹完整路径列表</h3>
                <div id="outputPathsList" style="margin-bottom: 15px;">
                    ${config.outputPaths.map((p, index) => `
                        <div style="display: flex; align-items: center; padding: 10px; background: #f8f9ff; border-radius: 6px; margin-bottom: 8px;">
                            <span style="flex: 1; font-family: monospace; font-size: 13px;">${escapeHtml(p)}</span>
                            <button onclick="deletePath('output', ${index})" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">删除</button>
                        </div>
                    `).join('') || '<p style="color: #999; font-style: italic;">暂无保存的输出路径</p>'}
                </div>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="newOutputPath" placeholder="输入新输出路径" style="flex: 1; padding: 10px; border: 2px solid #e0e0e0; border-radius: 6px;">
                    <button onclick="addPath('output')" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">添加</button>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="saveConfigBtn" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">保存配置</button>
                <button id="closeConfigBtn" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">关闭</button>
            </div>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        // 添加路径
        window.addPath = async (type) => {
            const inputId = type === 'project' ? 'newProjectPath' : 'newOutputPath';
            const newPath = document.getElementById(inputId).value.trim();
            if (!newPath) {
                alert('请输入路径');
                return;
            }
            
            try {
                const response = await fetch(`${API_BASE}/config/add-path`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, path: newPath })
                });
                
                if (response.ok) {
                    document.getElementById(inputId).value = '';
                    // 重新加载配置
                    configBtn.click();
                } else {
                    throw new Error('添加路径失败');
                }
            } catch (error) {
                alert('添加路径失败: ' + error.message);
            }
        };
        
        // 删除路径
        window.deletePath = async (type, index) => {
            if (!confirm('确定要删除这个路径吗？')) {
                return;
            }
            
            try {
                const response = await fetch(`${API_BASE}/config`);
                const data = await response.json();
                
                if (data.success) {
                    const pathKey = type === 'project' ? 'projectPaths' : 'outputPaths';
                    data.config[pathKey].splice(index, 1);
                    
                    const saveResponse = await fetch(`${API_BASE}/config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data.config)
                    });
                    
                    if (saveResponse.ok) {
                        // 重新加载配置
                        configBtn.click();
                    } else {
                        throw new Error('删除路径失败');
                    }
                }
            } catch (error) {
                alert('删除路径失败: ' + error.message);
            }
        };
        
        // 保存配置
        document.getElementById('saveConfigBtn').addEventListener('click', async () => {
            const projectBasePath = document.getElementById('projectBasePathInput').value.trim();
            const outputBasePath = document.getElementById('outputBasePathInput').value.trim();
            
            try {
                const response = await fetch(`${API_BASE}/config`);
                const data = await response.json();
                
                if (data.success) {
                    const saveResponse = await fetch(`${API_BASE}/config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            projectBasePath,
                            outputBasePath,
                            projectPaths: data.config.projectPaths || [],
                            outputPaths: data.config.outputPaths || []
                        })
                    });
                    
                    if (saveResponse.ok) {
                        alert('配置已保存！');
                        configBtn.click(); // 重新加载
                    } else {
                        throw new Error('保存配置失败');
                    }
                }
            } catch (error) {
                alert('保存配置失败: ' + error.message);
            }
        });
        
        // 关闭
        document.getElementById('closeConfigBtn').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
        
    } catch (error) {
        alert('加载配置失败: ' + error.message);
    }
});

// 事件监听
checkBtn.addEventListener('click', checkProject);
buildBtn.addEventListener('click', startBuild);

// 回车键检查项目
projectPathInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        checkProject();
    }
});

// 重启服务器
restartBtn.addEventListener('click', async () => {
    if (!confirm('确定要重启服务器吗？重启后请等待3-5秒，然后刷新页面。')) {
        return;
    }
    
    restartBtn.disabled = true;
    restartBtn.textContent = '正在重启...';
    
    try {
        const response = await fetch(`${API_BASE}/restart`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // 显示提示信息
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            `;
            
            const modalContent = document.createElement('div');
            modalContent.style.cssText = `
                background: white;
                padding: 30px;
                border-radius: 12px;
                max-width: 500px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                text-align: center;
            `;
            
            modalContent.innerHTML = `
                <h2 style="color: #667eea; margin-bottom: 20px;">🔄 正在重启服务器</h2>
                <p style="margin-bottom: 20px; color: #555; line-height: 1.6;">
                    ${data.message || '服务器正在重启中，请等待3-5秒...'}
                </p>
                <p style="margin-bottom: 20px; color: #999; font-size: 14px;">
                    重启完成后，页面会自动刷新。如果5秒后仍未刷新，请手动刷新页面。
                </p>
                <button id="refreshPageBtn" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">立即刷新页面</button>
            `;
            
            modal.appendChild(modalContent);
            document.body.appendChild(modal);
            
            // 刷新页面按钮
            document.getElementById('refreshPageBtn').addEventListener('click', () => {
                window.location.reload();
            });
            
            // 5秒后自动刷新页面
            setTimeout(() => {
                window.location.reload();
            }, 5000);
        } else {
            alert('重启失败: ' + (data.error || '未知错误'));
            restartBtn.disabled = false;
            restartBtn.textContent = '🔄 重启服务器';
        }
    } catch (error) {
        console.error('重启服务器错误:', error);
        // 即使请求失败，也可能是因为服务器已经开始重启了
        alert('重启请求已发送，请等待3-5秒后刷新页面。如果服务器未重启，请手动执行重启命令。');
        
        // 5秒后自动刷新页面
        setTimeout(() => {
            window.location.reload();
        }, 5000);
    }
});

