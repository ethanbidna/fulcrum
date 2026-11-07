use std::fs::{self, DirBuilder};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::DirBuilderExt;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_shell::{process::CommandChild, ShellExt};

const START_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_INTERVAL: Duration = Duration::from_millis(25);
const IO_TIMEOUT: Duration = Duration::from_secs(2);
const MAXIMUM_FRAME_BYTES: u64 = 65536;

#[derive(Clone)]
struct SocketClient {
    directory: PathBuf,
}

impl SocketClient {
    fn connect(&self) -> Result<UnixStream, String> {
        let started = Instant::now();
        loop {
            if let Ok(stream) = UnixStream::connect(self.directory.join("rpc.sock")) {
                stream.set_read_timeout(Some(IO_TIMEOUT)).map_err(|_| "Read timeout setup failed")?;
                stream.set_write_timeout(Some(IO_TIMEOUT)).map_err(|_| "Write timeout setup failed")?;
                return Ok(stream);
            }
            if started.elapsed() >= START_TIMEOUT {
                return Err("Sidecar did not start within ten seconds".into());
            }
            std::thread::sleep(CONNECT_INTERVAL);
        }
    }

    fn health(&self) -> Result<serde_json::Value, String> {
        let mut stream = self.connect()?;
        stream.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"health\"}\n").map_err(|_| "Sidecar request failed")?;
        let mut reader = BufReader::new(stream).take(MAXIMUM_FRAME_BYTES);
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|_| "Sidecar response failed")?;
        if !line.ends_with('\n') {
            return Err("Incomplete or oversized sidecar response".into());
        }
        let response: serde_json::Value = serde_json::from_str(&line).map_err(|_| "Invalid sidecar JSON")?;
        if response["jsonrpc"] != "2.0" || response["id"] != 1 || response.get("result").is_none() {
            return Err("Invalid sidecar health response".into());
        }
        Ok(response["result"].clone())
    }
}

struct SidecarState {
    client: SocketClient,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
async fn health(state: tauri::State<'_, SidecarState>) -> Result<serde_json::Value, String> {
    let client = state.client.clone();
    tauri::async_runtime::spawn_blocking(move || client.health()).await.map_err(|_| "Health worker failed")?
}

fn launch(app: &tauri::App) -> Result<SidecarState, Box<dyn std::error::Error>> {
    let directory = std::env::var_os("FULCRUM_S7_SOCKET_DIR").map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(format!("/tmp/fulcrum-s7-{}", std::process::id())));
    DirBuilder::new().mode(0o700).create(&directory)?;
    let socket = directory.join("rpc.sock");
    let socket_argument = socket.to_str().ok_or("Socket path must be UTF-8")?;
    let (mut events, child) = app.shell().sidecar("fulcrum-core")?.args(["--socket", socket_argument]).spawn()?;
    tauri::async_runtime::spawn(async move { while events.recv().await.is_some() {} });
    Ok(SidecarState { client: SocketClient { directory }, child: Mutex::new(Some(child)) })
}

fn main() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| { app.manage(launch(app)?); Ok(()) })
        .invoke_handler(tauri::generate_handler![health])
        .build(tauri::generate_context!())
        .expect("Packaging probe startup failed");
    application.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = handle.state::<SidecarState>();
            if let Some(child) = state.child.lock().expect("Sidecar lock failed").take() { let _ = child.kill(); }
            let _ = fs::remove_dir_all(&state.client.directory);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static SEQUENCE: AtomicUsize = AtomicUsize::new(0);

    fn response_from_test_server(response: &'static str) -> Result<serde_json::Value, String> {
        let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let directory = PathBuf::from(format!("/tmp/f7-rust-{}-{}", std::process::id(), sequence));
        DirBuilder::new().mode(0o700).create(&directory).unwrap();
        let listener = UnixListener::bind(directory.join("rpc.sock")).unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let request: serde_json::Value = serde_json::from_str(&line).unwrap();
            assert_eq!(request["method"], "health");
            stream.write_all(response.as_bytes()).unwrap();
        });
        let result = SocketClient { directory: directory.clone() }.health();
        server.join().unwrap();
        fs::remove_dir_all(directory).unwrap();
        result
    }

    #[test]
    fn socket_driver_reads_the_matching_rpc_response() {
        let result = response_from_test_server("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"fts5\":true}}\n").unwrap();
        assert_eq!(result["fts5"], true);
    }

    #[test]
    fn socket_driver_rejects_mismatched_ids_and_incomplete_frames() {
        assert!(response_from_test_server("{\"jsonrpc\":\"2.0\",\"id\":9,\"result\":{}}\n").is_err());
        assert!(response_from_test_server("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}").is_err());
    }
}
