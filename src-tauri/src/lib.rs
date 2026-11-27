use tauri::WebviewWindowBuilder;

/// Starts the desktop app: one window that shows the planner built into `dist/`.
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // The window is declared in tauri.conf.json (`"create": false`) and built here, because a download hook can
            // only be given to the builder. Without one the system webview ignores the planner's "Export plan" link
            // (it is a `download` attribute on a blob URL) and nothing is saved. With one the file goes to the user's
            // downloads folder under its suggested name, which is what a browser does.
            let config = app.config().app.windows[0].clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .on_download(|_webview, _event| true)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Factorio Planner");
}
