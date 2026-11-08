# Intel run observations

Synthetic quality runs completed on November 7, 2026 UTC:

- 3B: 22:06:31–22:51:49, about 45.3 minutes.
- 8B: 22:52:22–23:38:22, about 46.0 minutes, after a 30-second cooling interval.

Host: Intel x64 macOS 15.7.9, 32 GiB RAM, 16 logical CPUs. Exact model year was
not verified, so this is not proof of the specified 2019 hardware target.
Ollama 0.23.0; both installed models used Q4_K_M. Existing model aliases were
copied to the explicit instruct tags; digests and generation configuration are
recorded in the original reports. The runner did not capture its Node version;
no exact runner-version claim is made. No 1B download/run occurred, per owner choice.

Ollama and benchmark were launched with background taskpolicy/nice, local bind,
cloud disabled and one parallel request. The raw manual fields remain null:
launch policy is known, but effective per-thread QoS was not audited. Normal
unload was attempted by the runner; there was no timed interruption trial.

Development continued on the Mac during the runs, including a standalone Node
SEA smoke measurement. Heavy native builds ran on GitHub runners. These are
not isolated resource comparisons. System swap was already substantial before
3B; it cannot be attributed solely to either model.

The separate native thermal log contains nominal/fair samples during both run
windows, with no sampled serious/critical state. Sample counts in approximate
report windows: 3B 262 nominal / 2,180 fair; 8B 1,230 nominal / 1,190 fair.
Scheduling gaps exist; this is sampled telemetry, not continuous proof of a
thermal ceiling. Raw JSON thermal fields remain null because the probe was a
separate process. The complete time/state log is retained without personal paths.

All power samples report AC. Battery drain while unplugged, Finder/TextEdit
responsiveness, fan behavior and pause-to-idle/unload timing were not observed.
Apple Silicon and 1B were not tested. No hardware tier or resource threshold is
accepted from these observations. Owner sign-off for step 3 remains unchecked.

Original reports are preserved, including every attempt and resource sample;
review notes and recomputed audit output are separate. No gold labels or scores
were edited to improve the models' results.
