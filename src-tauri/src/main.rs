// Keeps the console window away on Windows release builds; do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    factorio_planner_desktop_lib::run()
}
