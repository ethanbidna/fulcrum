use super::CoreSocket;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

#[repr(C)]
#[derive(Clone, Copy)]
struct Sample {
    awake: i32, power: i32, battery_percent: i32, thermal: i32,
    available_memory_bytes: u64, wake_generation: u64,
}
struct Mailbox {
    sample: Mutex<Option<Sample>>, worker: Mutex<Option<thread::Thread>>, stopped: AtomicBool,
}
static MAILBOX: OnceLock<Arc<Mailbox>> = OnceLock::new();
const RETRY_INTERVAL: Duration = Duration::from_secs(5);
#[cfg(target_os = "macos")]
extern "C" {
    fn fulcrum_start_system_signals(callback: extern "C" fn(*const Sample));
    fn fulcrum_stop_system_signals();
}
extern "C" fn observe(sample: *const Sample) {
    if sample.is_null() { return; }
    if let Some(mailbox) = MAILBOX.get() {
        // The native driver lends a stack sample for the duration of this call.
        if let Ok(mut current) = mailbox.sample.lock() { *current = Some(unsafe { *sample }); }
        if let Ok(worker) = mailbox.worker.lock() { if let Some(worker) = worker.as_ref() { worker.unpark(); } }
    }
}
fn payload(sample: Sample) -> Value {
    let thermal = match sample.thermal { 0 => "nominal", 1 => "fair", 2 => "serious", 3 => "critical", _ => "unknown" };
    let power = match sample.power { 1 => "ac", 2 => "battery", _ => "unknown" };
    json!({ "awake": sample.awake != 0, "wakeGeneration": sample.wake_generation,
        "power": power, "batteryPercent": if (0..=100).contains(&sample.battery_percent) { Some(sample.battery_percent) } else { None },
        "thermal": thermal, "availableMemoryBytes": if sample.available_memory_bytes > 0 { Some(sample.available_memory_bytes) } else { None },
        "architecture": if cfg!(target_arch = "aarch64") { "apple_silicon" } else { "intel" } })
}
pub struct SystemObserver { mailbox: Arc<Mailbox> }
impl SystemObserver {
    pub fn start(core: Arc<CoreSocket>) -> Self {
        let mailbox = Arc::new(Mailbox { sample: Mutex::new(None), worker: Mutex::new(None), stopped: AtomicBool::new(false) });
        assert!(MAILBOX.set(mailbox.clone()).is_ok(), "System observer already started");
        let worker = mailbox.clone();
        thread::spawn(move || {
            if let Ok(mut current) = worker.worker.lock() { *current = Some(thread::current()); }
            while !worker.stopped.load(Ordering::SeqCst) {
                let sample = worker.sample.lock().ok().and_then(|mut current| current.take());
                if let Some(sample) = sample { if let Ok(mut client) = core.connect() { let _ = client.request("system.observe", payload(sample)); } }
                thread::park_timeout(RETRY_INTERVAL);
            }
        });
        #[cfg(target_os = "macos")]
        unsafe { fulcrum_start_system_signals(observe); }
        Self { mailbox }
    }
    pub fn stop(&self) {
        #[cfg(target_os = "macos")]
        unsafe { fulcrum_stop_system_signals(); }
        self.mailbox.stopped.store(true, Ordering::SeqCst);
        if let Ok(worker) = self.mailbox.worker.lock() { if let Some(worker) = worker.as_ref() { worker.unpark(); } }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_unknowns_remain_unknown_and_wake_generation_survives_coalescing() {
        let value = payload(Sample { awake: 1, power: 0, battery_percent: -1, thermal: 4, available_memory_bytes: 0, wake_generation: 3 });
        assert_eq!(value["power"], "unknown"); assert!(value["batteryPercent"].is_null());
        assert!(value["availableMemoryBytes"].is_null()); assert_eq!(value["thermal"], "unknown"); assert_eq!(value["wakeGeneration"], 3);
    }
}
