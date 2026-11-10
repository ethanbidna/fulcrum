#import <AppKit/AppKit.h>
#import <Security/Security.h>
#include <stdlib.h>
#include <string.h>

char *fulcrum_choose_directory(const char *initial) {
    __block char *result = NULL;
    void (^choose)(void) = ^{
        NSOpenPanel *panel = [NSOpenPanel openPanel];
        panel.canChooseDirectories = YES; panel.canChooseFiles = NO;
        panel.allowsMultipleSelection = NO; panel.canCreateDirectories = YES;
        panel.prompt = @"Choose workspace folder";
        if (initial && strlen(initial)) panel.directoryURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:initial]];
        if ([panel runModal] == NSModalResponseOK) result = strdup(panel.URL.path.UTF8String);
    };
    if ([NSThread isMainThread]) choose(); else dispatch_sync(dispatch_get_main_queue(), choose);
    return result;
}
char *fulcrum_new_identifier(void) { return strdup(NSUUID.UUID.UUIDString.lowercaseString.UTF8String); }
void fulcrum_free_setup_string(char *value) { free(value); }

char *fulcrum_provider_keychain(const char *action, const char *input) {
    @autoreleasepool {
        NSData *bytes = [[NSString stringWithUTF8String:input] dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *request = [NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
        if (![request isKindOfClass:NSDictionary.class] || ![request[@"provider"] isEqual:@"anthropic"]) return NULL;
        NSMutableDictionary *query = [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService:@"Fulcrum.Provider.Anthropic", (__bridge id)kSecAttrAccount:@"api-key"} mutableCopy];
        NSString *operation = [NSString stringWithUTF8String:action];
        NSDictionary *result;
        if ([operation isEqual:@"get"]) {
            query[(__bridge id)kSecReturnData] = @YES;
            CFTypeRef value = NULL; OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &value);
            if (status != errSecSuccess || !value) return NULL;
            NSData *data = CFBridgingRelease(value); NSString *key = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            if (!key) return NULL; result = @{@"key":key};
        } else if ([operation isEqual:@"set"]) {
            NSString *key = request[@"key"];
            if (![key isKindOfClass:NSString.class] || key.length == 0 || key.length > 4096 || [key rangeOfCharacterFromSet:NSCharacterSet.newlineCharacterSet].location != NSNotFound) return NULL;
            NSData *data = [key dataUsingEncoding:NSUTF8StringEncoding];
            NSDictionary *attributes = @{(__bridge id)kSecValueData:data, (__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};
            OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)attributes);
            if (status == errSecItemNotFound) { [query addEntriesFromDictionary:attributes]; status = SecItemAdd((__bridge CFDictionaryRef)query, NULL); }
            if (status != errSecSuccess) return NULL; result = @{@"stored":@YES};
        } else if ([operation isEqual:@"remove"]) {
            OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
            if (status != errSecSuccess && status != errSecItemNotFound) return NULL; result = @{@"removed":@YES};
        } else return NULL;
        NSData *encoded = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
        return strdup([[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding].UTF8String);
    }
}
