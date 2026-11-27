/// Starts the desktop app: the window declared in tauri.conf.json, showing the planner built into `dist-desktop/`.
///
/// The planner's Export plan needs no hook: wry's default download handler accepts every download and saves it to the
/// user's downloads folder under its suggested name, on all three webviews.
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the Factorio Planner");
}
