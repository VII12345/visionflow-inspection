fn main() {
    // 整个应用以管理员运行：LECPServer.exe 的 manifest 是 requireAdministrator，
    // 后端需提权才能静默拉起它；因此主程序同样要求管理员（启动时一次 UAC）。
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("manifest.xml"));
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("failed to run build script");
}
