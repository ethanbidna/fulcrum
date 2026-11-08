use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;
use serde_json::{json, Value};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 64 * 1024;

pub struct Client { reader: BufReader<UnixStream> }
impl Client {
    pub fn connect(path: &std::path::Path, secret: &str) -> Result<Self, String> {
        let stream = UnixStream::connect(path).map_err(|_| "CORE_UNAVAILABLE")?;
        stream.set_read_timeout(Some(REQUEST_TIMEOUT)).map_err(|_| "CORE_UNAVAILABLE")?;
        stream.set_write_timeout(Some(REQUEST_TIMEOUT)).map_err(|_| "CORE_UNAVAILABLE")?;
        let mut client = Self { reader: BufReader::new(stream) };
        client.request("authenticate", json!({ "secret": secret }))?;
        Ok(client)
    }
    pub fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let mut frame = serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })).map_err(|_| "INVALID_REQUEST")?;
        if frame.len() > MAX_REQUEST_BYTES { return Err("REQUEST_TOO_LARGE".into()); }
        frame.push(b'\n');
        self.reader.get_mut().write_all(&frame).map_err(|_| "CORE_UNAVAILABLE")?;
        let message = self.read()?;
        if message["jsonrpc"] != "2.0" || message["id"] != 1 { return Err("INVALID_RESPONSE".into()); }
        if let Some(error) = message.get("error") {
            let code = error["data"]["code"].as_str().unwrap_or("CORE_REQUEST_FAILED");
            return Err(match code { "VALIDATION_FAILED" | "NOT_FOUND" | "WORKSPACE_UNAVAILABLE" | "INDEX_UNAVAILABLE" => code.into(), _ => "CORE_REQUEST_FAILED".into() });
        }
        message.get("result").cloned().ok_or_else(|| "INVALID_RESPONSE".into())
    }
    pub fn subscription_stream(&self) -> Result<UnixStream, String> {
        self.reader.get_ref().set_read_timeout(None).map_err(|_| "CORE_UNAVAILABLE")?;
        self.reader.get_ref().try_clone().map_err(|_| "CORE_UNAVAILABLE".into())
    }
    pub fn read(&mut self) -> Result<Value, String> {
        let mut line = String::new();
        self.reader.by_ref().take(MAX_RESPONSE_BYTES + 1).read_line(&mut line).map_err(|_| "CORE_UNAVAILABLE")?;
        if !line.ends_with('\n') || line.len() as u64 > MAX_RESPONSE_BYTES { return Err("INVALID_RESPONSE".into()); }
        serde_json::from_str(&line).map_err(|_| "INVALID_RESPONSE".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static SEQUENCE: AtomicUsize = AtomicUsize::new(0);
    fn exchange(reply: &str) -> Result<Value, String> {
        let path = std::env::temp_dir().join(format!("fu1-{}-{}.sock", std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        let server = UnixListener::bind(&path).unwrap();
        let reply = reply.to_owned();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new(); reader.read_line(&mut line).unwrap();
            let auth: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(auth["method"], "authenticate"); assert_eq!(auth["params"]["secret"], "synthetic-secret");
            stream.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n").unwrap();
            line.clear(); reader.read_line(&mut line).unwrap();
            let request: Value = serde_json::from_str(&line).unwrap(); assert_eq!(request["method"], "query");
            stream.write_all(reply.as_bytes()).unwrap();
        });
        let result = Client::connect(&path, "synthetic-secret").and_then(|mut client| client.request("query", json!({ "name": "portfolio.list", "args": {} })));
        worker.join().unwrap(); std::fs::remove_file(path).unwrap(); result
    }
    #[test] fn authenticates_before_querying() { assert_eq!(exchange("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":[]}\n").unwrap(), json!([])); }
    #[test] fn rejects_incomplete_or_mismatched_response() {
        assert!(exchange("{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":[]}\n").is_err());
        assert!(exchange("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":[]}").is_err());
    }
    #[test] fn does_not_echo_untrusted_error_text() {
        assert_eq!(exchange("{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"message\":\"untrusted\",\"data\":{\"code\":\"untrusted\"}}}\n").unwrap_err(), "CORE_REQUEST_FAILED");
    }
}
