#import <AppKit/AppKit.h>
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <libproc.h>
#import <unistd.h>

static NSDictionary *signingInfo(SecCodeRef code) {
    SecStaticCodeRef staticCode = NULL;
    if (SecCodeCopyStaticCode(code, kSecCSDefaultFlags, &staticCode) != errSecSuccess) return nil;
    CFDictionaryRef information = NULL;
    OSStatus status = SecCodeCopySigningInformation(staticCode, kSecCSSigningInformation, &information);
    CFRelease(staticCode);
    if (status != errSecSuccess) return nil;
    return CFBridgingRelease(information);
}

static BOOL trustedCore(void) {
    NSURL *profile = [NSBundle.mainBundle.bundleURL URLByAppendingPathComponent:@"Contents/embedded.provisionprofile"];
    if (![profile checkResourceIsReachableAndReturnError:nil]) return NO;
    pid_t parent = getppid();
    char executable[PROC_PIDPATHINFO_MAXSIZE];
    if (proc_pidpath(parent, executable, sizeof executable) <= 0) return NO;
    NSURL *expected = [[NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"bin/fulcrum-core"] URLByResolvingSymlinksInPath];
    NSURL *actual = [[NSURL fileURLWithPath:@(executable)] URLByResolvingSymlinksInPath];
    if (![actual.path isEqualToString:expected.path]) return NO;
    SecCodeRef guest = NULL, selfCode = NULL;
    NSDictionary *attributes = @{(__bridge id)kSecGuestAttributePid:@(parent)};
    if (SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &guest) != errSecSuccess) return NO;
    BOOL valid = NO;
    if (SecCodeCheckValidity(guest, kSecCSDefaultFlags, NULL) == errSecSuccess &&
        SecCodeCopySelf(kSecCSDefaultFlags, &selfCode) == errSecSuccess) {
        NSString *team = signingInfo(selfCode)[(__bridge id)kSecCodeInfoTeamIdentifier];
        valid = team.length && [team isEqual:signingInfo(guest)[(__bridge id)kSecCodeInfoTeamIdentifier]];
    }
    if (selfCode) CFRelease(selfCode);
    CFRelease(guest);
    return valid && parent == getppid();
}

static NSMutableDictionary *keyQuery(NSString *account) {
    NSArray *parts = [account componentsSeparatedByString:@":"];
    if (parts.count != 2) return nil;
    for (NSString *part in parts) {
        NSUUID *identifier = [[NSUUID alloc] initWithUUIDString:part];
        if (![identifier.UUIDString.lowercaseString isEqual:part]) return nil;
    }
    LAContext *context = [[LAContext alloc] init];
    context.interactionNotAllowed = YES;
    return [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService:@"Fulcrum.WorkspaceKey.v1",
        (__bridge id)kSecAttrAccount:account,
        (__bridge id)kSecUseDataProtectionKeychain:@YES,
        (__bridge id)kSecAttrSynchronizable:@NO,
        (__bridge id)kSecUseAuthenticationContext:context} mutableCopy];
}

static NSData *recoveryPanel(NSData *input, BOOL confirm) {
    [NSApplication sharedApplication];
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = confirm ? @"Save and verify your recovery card" : @"Import your workspace recovery card";
    alert.informativeText = confirm
        ? @"Save this card outside the workspace in a password manager or offline. Paste your saved copy below to verify it. Anyone with this card can open the workspace."
        : [NSString stringWithFormat:@"Paste the saved recovery card. Workspace and key IDs: %@", [[NSString alloc] initWithData:input encoding:NSASCIIStringEncoding]];
    NSStackView *fields = [NSStackView stackViewWithViews:@[]];
    fields.orientation = NSUserInterfaceLayoutOrientationVertical;
    if (confirm) {
        NSTextField *card = [NSTextField wrappingLabelWithString:[[NSString alloc] initWithData:input encoding:NSUTF8StringEncoding]];
        card.selectable = YES;
        [card.widthAnchor constraintEqualToConstant:460].active = YES;
        [fields addArrangedSubview:card];
    }
    NSSecureTextField *entry = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 460, 24)];
    entry.placeholderString = @"Recovery card";
    [entry.widthAnchor constraintEqualToConstant:460].active = YES;
    [fields addArrangedSubview:entry];
    alert.accessoryView = fields;
    [alert addButtonWithTitle:confirm ? @"Verify saved card" : @"Import card"];
    [alert addButtonWithTitle:@"Cancel"];
    [alert.window setInitialFirstResponder:entry];
    [NSApp activateIgnoringOtherApps:YES];
    if ([alert runModal] != NSAlertFirstButtonReturn) return nil;
    NSData *result = [entry.stringValue dataUsingEncoding:NSUTF8StringEncoding];
    entry.stringValue = @"";
    return result.length && result.length <= 1024 ? result : nil;
}

int fulcrum_workspace_key_request(const char *action, const unsigned char *input, size_t length,
    unsigned char *output, size_t *outputLength) {
    @autoreleasepool {
        if (!trustedCore()) return 1;
        NSString *operation = @(action);
        NSData *result = nil;
        if ([operation isEqual:@"confirm"] || [operation isEqual:@"recover"]) {
            BOOL confirm = [operation isEqual:@"confirm"];
            if ((!confirm && length != 73) || length > 1024 || (confirm && length == 0)) return 1;
            result = recoveryPanel([NSData dataWithBytes:input length:length], confirm);
            if (!result) return 3;
        } else {
            const size_t accountLength = 73;
            BOOL get = [operation isEqual:@"get"];
            BOOL add = [operation isEqual:@"add"];
            if ((!get && !add) || length != accountLength + (add ? 32 : 0)) return 1;
            NSString *account = [[NSString alloc] initWithBytes:input length:accountLength encoding:NSASCIIStringEncoding];
            NSMutableDictionary *query = keyQuery(account);
            if (!query) return 1;
            if (get) {
                query[(__bridge id)kSecReturnData] = @YES;
                CFTypeRef value = NULL;
                OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &value);
                if (status == errSecItemNotFound) return 2;
                if (status != errSecSuccess || !value) return 1;
                result = CFBridgingRelease(value);
                if (![result isKindOfClass:NSData.class] || result.length != 32) return 1;
            } else {

                query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
                query[(__bridge id)kSecValueData] = [NSData dataWithBytes:input + accountLength length:32];
                if (SecItemAdd((__bridge CFDictionaryRef)query, NULL) != errSecSuccess) return 1;
                *outputLength = 0;
                return 0;
            }
        }
        if (result.length > *outputLength) return 1;
        memcpy(output, result.bytes, result.length);
        *outputLength = result.length;
        return 0;
    }
}

int fulcrum_privacy_dialog(const char *message, const char *button) {
    __block BOOL accepted = NO;
    void (^show)(void) = ^{
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"Workspace privacy";
        alert.informativeText = @(message);
        [alert addButtonWithTitle:@(button)];
        [alert addButtonWithTitle:@"Cancel"];
        accepted = [alert runModal] == NSAlertFirstButtonReturn;
    };
    if (NSThread.isMainThread) show(); else dispatch_sync(dispatch_get_main_queue(), show);
    return accepted ? 1 : 0;
}

void fulcrum_privacy_notice(const char *message) {
    void (^show)(void) = ^{
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"Workspace privacy";
        alert.informativeText = @(message);
        [alert addButtonWithTitle:@"OK"];
        [alert runModal];
    };
    if (NSThread.isMainThread) show(); else dispatch_sync(dispatch_get_main_queue(), show);
}
