/**
 * 视觉检测系统 — 文件标签页
 * 线体配置 + 产品型号管理
 */

const FileTab = {
  async render() {
    await this._syncModelStatus();
    this.renderLineConfig();
    this.renderProducts();
  },

  /** 从后端同步模型文件，更新产品已学习状态 */
  async _syncModelStatus() {
    try {
      const data = await window.electronAPI.backendFetch('/api/models');
      if (data.success && data.models) {
        const trainedNames = new Set(data.models.map(m => m.name));
        const products = DB.getProducts();
        let changed = false;
        for (const p of products) {
          const was = p.learned;
          p.learned = trainedNames.has(p.model);
          if (p.learned !== was) changed = true;
        }
        if (changed) DB.saveProducts(products);
      }
    } catch (_) {}
  },

  // ======== 线体配置表 ========
  renderLineConfig() {
    const config = DB.getLineConfig();
    const products = DB.getProducts();
    const wrap = document.getElementById('lineConfigTable');
    let html = `<table>
      <thead><tr>
        <th>线体</th>
        <th>检测产品型号</th>
        <th>状态</th>
      </tr></thead><tbody>`;
    for (const item of config) {
      const prod = products.find(p => p.id === item.productId);
      const modelName = prod ? prod.model : '-';
      const status = prod
        ? (prod.learned
          ? '<span class="badge-learned">已学习</span>'
          : '<span class="badge-unlearned">未学习</span>')
        : '<span style="color:#6a7b94">未配置</span>';
      html += `<tr>
        <td><strong>线体 ${item.line}</strong></td>
        <td>${modelName}</td>
        <td>${status}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
  },

  // ======== 产品型号表 ========
  renderProducts() {
    const products = DB.getProducts();
    const wrap = document.getElementById('productTable');
    let html = `<table>
      <thead><tr>
        <th>选择</th>
        <th>型号</th>
        <th>尺寸</th>
        <th>学习状态</th>
        <th>分配线体</th>
        <th>操作</th>
      </tr></thead><tbody>`;
    for (const p of products) {
      html += `<tr class="${p.learned ? '' : 'unlearned'}">
        <td><input type="checkbox" class="checkbox-custom" id="prod-check-${p.id}" onchange="FileTab.onCheckChange(${p.id})"></td>
        <td><strong>${p.model}</strong></td>
        <td>${p.size}</td>
        <td>${p.learned
          ? '<span class="badge-learned">已学习</span>'
          : '<span class="badge-unlearned">未学习</span>'}</td>
        <td>
          <select id="prod-line-${p.id}" style="width:100px">
            <option value="">--</option>
            <option value="1">线体 1</option>
            <option value="2">线体 2</option>
            <option value="3">线体 3</option>
            <option value="4">线体 4</option>
          </select>
        </td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="FileTab.assignProduct(${p.id})">传送</button>
        </td>
      </tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
  },

  onCheckChange(productId) {
    const cb = document.getElementById(`prod-check-${productId}`);
    if (cb.checked) {
      document.querySelectorAll('[id^="prod-check-"]').forEach(el => {
        if (el.id !== `prod-check-${productId}`) el.checked = false;
      });
    }
  },

  assignProduct(productId) {
    // 权限检查：技术员或以上
    if (!App.user) { App.showLogin(); return; }
    if (!Permissions.canConfigCamera(App.user)) {
      App.showMessage('需要技术员或以上权限才能修改检测配置');
      return;
    }
    const line = document.getElementById(`prod-line-${productId}`).value;
    if (!line) {
      App.showMessage('请先选择线体');
      return;
    }
    const config = DB.getLineConfig();
    const products = DB.getProducts();
    const prod = products.find(p => p.id === productId);
    const lineIdx = parseInt(line) - 1;
    config[lineIdx] = { line: parseInt(line), productId, model: prod.model };
    DB.saveLineConfig(config);
    this.renderLineConfig();
    // 刷新运行页面的相机卡片型号
    RunTab.render();
    App.showMessage(`已将 ${prod.model} 分配到线体 ${line}`);
  },

  // ======== 新增产品 ========
  showAddProduct() {
    document.getElementById('newProdModel').value = '';
    document.getElementById('newProdSize').value = '';
    App.openModal('addProductModal');
  },

  doAddProduct() {
    const model = document.getElementById('newProdModel').value.trim();
    const size = document.getElementById('newProdSize').value.trim();
    if (!model || !size) {
      App.showMessage('请填写完整的产品信息');
      return;
    }
    const products = DB.getProducts();
    if (products.find(p => p.model === model)) {
      App.showMessage('该型号已存在');
      return;
    }
    products.push({
      id: Date.now(),
      model,
      size,
      learned: false,
    });
    DB.saveProducts(products);
    this.renderProducts();
    SettingsTab.render();
    App.closeModal('addProductModal');
    App.showMessage(`产品 ${model} 已新增（未学习状态）`);
  },
};