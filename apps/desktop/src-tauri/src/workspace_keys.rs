use std::ffi::CString;
use std::io::{IsTerminal, Read, Write};
const MAX_FRAME: usize = 1024;
extern "C" {
    fn fulcrum_workspace_key_request(action: *const std::ffi::c_char, input: *const u8, length: usize,
        output: *mut u8, output_length: *mut usize) -> i32;
}
fn clear(bytes: &mut [u8]) {
    for byte in bytes { unsafe { std::ptr::write_volatile(byte, 0) }; }
}
pub fn helper_mode() -> Option<i32> {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("--workspace-key-helper") { return None; }
    if args.len() != 3 || std::io::stdin().is_terminal() || std::io::stdout().is_terminal() { return Some(1); }
    let action = CString::new(args[2].as_str()).ok()?;
    let mut input = Vec::with_capacity(MAX_FRAME + 1);
    let mut output = [0; MAX_FRAME];
    let mut length = output.len();
    let result = if std::io::stdin().take((MAX_FRAME + 1) as u64).read_to_end(&mut input).is_ok() && input.len() <= MAX_FRAME {
        let status = unsafe { fulcrum_workspace_key_request(action.as_ptr(), input.as_ptr(), input.len(), output.as_mut_ptr(), &mut length) };
        if status == 0 && std::io::stdout().write_all(&output[..length]).is_err() { 1 } else { status }
    } else { 1 };
    clear(&mut input);
    clear(&mut output);
    Some(result)
}
