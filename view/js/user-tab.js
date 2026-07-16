/**
 * 视觉检测系统 — 用户管理标签页
 * 账户 CRUD + 修改密码
 */

const UserTab = {
  render() {
    this.renderUserList();
  },

  renderUserList() {
    const users = DB.getUsers();
    const wrap = document.getElementById('userTable');
    let html = `<table>
      <thead><tr>
        <th>ID</th>
        <th>用户名</th>
        <th>用户级别</th>
      </tr></thead><tbody>`;
    for (const u of users) {
      const levelMap = { admin: '管理员', tech: '技术员', operator: '操作员' };
      html += `<tr>
        <td>${u.id}</td>
        <td>${u.name}</td>
        <td><span class="user-role-badge role-${u.level}">${levelMap[u.level] || u.level}</span></td>
      </tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
  },

  // ======== 新建账户 ========

  saveUser() {
    if (!this._checkAdmin()) return;

    const name = document.getElementById('newUserName').value.trim();
    const pwd = document.getElementById('newUserPwd').value.trim();
    const pwd2 = document.getElementById('newUserPwd2').value.trim();
    const level = document.getElementById('newUserLevel').value;

    if (!name) { App.showMessage('请输入用户名'); return; }
    if (!pwd || pwd.length < 3) { App.showMessage('密码至少3位'); return; }
    if (pwd !== pwd2) { App.showMessage('两次密码不一致'); return; }

    const users = DB.getUsers();
    if (users.find(u => u.name === name)) { App.showMessage('用户名已存在'); return; }

    const maxId = users.reduce((max, u) => Math.max(max, u.id), 0);
    users.push({ id: maxId + 1, name, password: pwd, level });
    DB.saveUsers(users);
    this.renderUserList();

    document.getElementById('newUserName').value = '';
    document.getElementById('newUserPwd').value = '';
    document.getElementById('newUserPwd2').value = '';
    document.getElementById('newUserLevel').value = 'operator';

    App.showMessage(`账户 ${name} 创建成功`);
  },

  async deleteUser() {
    if (!this._checkAdmin()) return;

    const name = document.getElementById('newUserName').value.trim();
    if (!name) { App.showMessage('请输入要删除的用户名'); return; }
    if (App.user && App.user.name === name) { App.showMessage('不能删除当前登录账户'); return; }

    let users = DB.getUsers();
    const idx = users.findIndex(u => u.name === name);
    if (idx === -1) { App.showMessage('用户不存在'); return; }

    const ok = await App.confirm(`确认删除用户「${name}」？`);
    if (!ok) return;

    users.splice(idx, 1);
    DB.saveUsers(users);
    this.renderUserList();
    document.getElementById('newUserName').value = '';
    App.showMessage(`用户 ${name} 已删除`);
  },

  _checkAdmin() {
    if (!App.user) { App.showLogin(); return false; }
    if (!Permissions.isAdmin(App.user)) {
      App.showMessage('需要管理员权限才能管理账户');
      return false;
    }
    return true;
  },

  // ======== 修改密码 ========

  showChangePwdModal() {
    if (!App.user) { App.showLogin(); return; }

    document.getElementById('chgOldPwd').value = '';
    document.getElementById('chgNewPwd').value = '';
    document.getElementById('chgConfirmPwd').value = '';
    document.getElementById('chgPwdError').style.display = 'none';
    App.openModal('changePwdModal');
  },

  doChangePassword() {
    const user = App.user;
    if (!user) return;

    const oldPwd = document.getElementById('chgOldPwd').value.trim();
    const newPwd = document.getElementById('chgNewPwd').value.trim();
    const confirmPwd = document.getElementById('chgConfirmPwd').value.trim();
    const errEl = document.getElementById('chgPwdError');

    if (!oldPwd || !newPwd || !confirmPwd) {
      errEl.textContent = '请填写所有密码字段';
      errEl.style.display = 'block';
      return;
    }

    const users = DB.getUsers();
    const u = users.find(u => u.id === user.id);
    if (!u) {
      errEl.textContent = '用户数据异常';
      errEl.style.display = 'block';
      return;
    }

    if (u.password !== oldPwd) {
      errEl.textContent = '旧密码错误';
      errEl.style.display = 'block';
      return;
    }

    if (newPwd.length < 3) {
      errEl.textContent = '新密码至少3位';
      errEl.style.display = 'block';
      return;
    }

    if (newPwd !== confirmPwd) {
      errEl.textContent = '两次新密码不一致';
      errEl.style.display = 'block';
      return;
    }

    u.password = newPwd;
    DB.saveUsers(users);

    App.closeModal('changePwdModal');
    App.showMessage('密码修改成功，下次登录请使用新密码');
  },
};