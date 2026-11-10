#import <AppKit/AppKit.h>
#import <IOKit/ps/IOPowerSources.h>
#import <IOKit/ps/IOPSKeys.h>
#import <mach/mach.h>
#include <stdint.h>

typedef struct {
    int32_t awake, power, battery_percent, thermal;
    uint64_t available_memory_bytes, wake_generation;
} FulcrumSystemSample;
typedef void (*SampleCallback)(const FulcrumSystemSample *);
static const NSTimeInterval SAMPLE_INTERVAL_SECONDS = 5;
static const int32_t PERCENT_FULL = 100, BATTERY_UNKNOWN = -1;
static const int32_t POWER_UNKNOWN = 0, POWER_AC = 1, POWER_BATTERY = 2;
static SampleCallback receiver;
static BOOL awake = YES;
static uint64_t wakeGeneration = 0;
static NSTimer *timer;
static NSMutableArray *observers;
static CFRunLoopSourceRef powerSource;

static uint64_t availableMemory(void) {
    vm_statistics64_data_t statistics;
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    mach_port_t host = mach_host_self();
    kern_return_t result = host_statistics64(host, HOST_VM_INFO64, (host_info64_t)&statistics, &count);
    mach_port_deallocate(mach_task_self(), host);
    if (result != KERN_SUCCESS) return 0;
    return ((uint64_t)statistics.free_count + statistics.inactive_count) * vm_page_size;
}
static void readPower(FulcrumSystemSample *sample) {
    CFTypeRef information = IOPSCopyPowerSourcesInfo();
    if (!information) return;
    CFStringRef providing = IOPSGetProvidingPowerSourceType(information);
    if (providing && CFEqual(providing, CFSTR(kIOPSACPowerValue))) sample->power = POWER_AC;
    else if (providing && CFEqual(providing, CFSTR(kIOPSBatteryPowerValue))) sample->power = POWER_BATTERY;
    CFArrayRef sources = IOPSCopyPowerSourcesList(information);
    for (CFIndex index = 0; sources && index < CFArrayGetCount(sources); index++) {
        CFDictionaryRef description = IOPSGetPowerSourceDescription(information, CFArrayGetValueAtIndex(sources, index));
        if (!description) continue;
        CFTypeRef type = CFDictionaryGetValue(description, CFSTR(kIOPSTypeKey));
        if (!type || !CFEqual(type, CFSTR(kIOPSInternalBatteryType))) continue;
        CFTypeRef current = CFDictionaryGetValue(description, CFSTR(kIOPSCurrentCapacityKey));
        CFTypeRef maximum = CFDictionaryGetValue(description, CFSTR(kIOPSMaxCapacityKey));
        int capacity = 0, total = 0;
        if (current && maximum && CFGetTypeID(current) == CFNumberGetTypeID() && CFGetTypeID(maximum) == CFNumberGetTypeID()
            && CFNumberGetValue(current, kCFNumberIntType, &capacity) && CFNumberGetValue(maximum, kCFNumberIntType, &total) && total > 0) {
            sample->battery_percent = (int32_t)((int64_t)capacity * PERCENT_FULL / total);
            break;
        }
    }
    if (sources) CFRelease(sources);
    CFRelease(information);
}
static void publish(void) {
    if (!receiver) return;
    FulcrumSystemSample sample = { .awake = awake, .power = POWER_UNKNOWN, .battery_percent = BATTERY_UNKNOWN,
        .thermal = (int32_t)NSProcessInfo.processInfo.thermalState, .available_memory_bytes = availableMemory(), .wake_generation = wakeGeneration };
    readPower(&sample);
    receiver(&sample);
}
static void powerChanged(void *context) { (void)context; publish(); }
void fulcrum_start_system_signals(SampleCallback callback) {
    receiver = callback;
    observers = [NSMutableArray array];
    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    [observers addObject:[workspace addObserverForName:NSWorkspaceWillSleepNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *notification) { (void)notification; awake = NO; publish(); }]];
    [observers addObject:[workspace addObserverForName:NSWorkspaceDidWakeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *notification) { (void)notification; awake = YES; wakeGeneration++; publish(); }]];
    // Reading the property enables Apple's thermal-change notifications.
    (void)NSProcessInfo.processInfo.thermalState;
    [observers addObject:[NSNotificationCenter.defaultCenter addObserverForName:NSProcessInfoThermalStateDidChangeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *notification) { (void)notification; publish(); }]];
    powerSource = IOPSNotificationCreateRunLoopSource(powerChanged, NULL);
    if (powerSource) CFRunLoopAddSource(CFRunLoopGetMain(), powerSource, kCFRunLoopCommonModes);
    timer = [NSTimer timerWithTimeInterval:SAMPLE_INTERVAL_SECONDS repeats:YES block:^(NSTimer *value) { (void)value; publish(); }];
    [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
    publish();
}
void fulcrum_stop_system_signals(void) {
    [timer invalidate]; timer = nil;
    for (id observer in observers) {
        [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:observer];
        [NSNotificationCenter.defaultCenter removeObserver:observer];
    }
    observers = nil;
    if (powerSource) { CFRunLoopRemoveSource(CFRunLoopGetMain(), powerSource, kCFRunLoopCommonModes); CFRelease(powerSource); powerSource = NULL; }
    receiver = NULL;
}
