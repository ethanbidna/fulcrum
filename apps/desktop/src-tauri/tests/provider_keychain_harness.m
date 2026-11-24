#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern char *fulcrum_provider_keychain(const char *, const char *);
extern void fulcrum_free_setup_string(char *);

// Substitute Security calls so this test never reads or changes the user's Keychain.
static BOOL expected_query(CFDictionaryRef raw) {
    NSDictionary *query = (__bridge NSDictionary *)raw;
    return [query[(__bridge id)kSecAttrService] isEqual:@"Fulcrum.Connector.Activepieces"]
        && ( [query[(__bridge id)kSecAttrAccount] isEqual:@"local-runtime"]
          || [query[(__bridge id)kSecAttrAccount] isEqual:@"runtime-keys"]);
}
OSStatus SecItemCopyMatching(CFDictionaryRef query, CFTypeRef *result) {
    if (!expected_query(query)) return errSecParam;
    const char *state = getenv("FULCRUM_TEST_KEYCHAIN_STATE");
    if (state && strcmp(state, "denied") == 0) return errSecInteractionNotAllowed;
    if (!state || strcmp(state, "missing") == 0) return errSecItemNotFound;
    NSDictionary *attributes = (__bridge NSDictionary *)query;
    NSString *value = [attributes[(__bridge id)kSecAttrAccount] isEqual:@"runtime-keys"] ? @"synthetic-runtime-keys" : @"synthetic-identity";
    *result = CFBridgingRetain([value dataUsingEncoding:NSUTF8StringEncoding]);
    return errSecSuccess;
}
OSStatus SecItemUpdate(CFDictionaryRef query, CFDictionaryRef rawAttributes) {
    if (!expected_query(query)) return errSecParam;
    NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
    return [attributes[(__bridge id)kSecAttrAccessible] isEqual:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        && attributes[(__bridge id)kSecValueData] ? errSecSuccess : errSecParam;
}
OSStatus SecItemAdd(CFDictionaryRef query, CFTypeRef *result) { return errSecParam; }
OSStatus SecItemDelete(CFDictionaryRef query) { return expected_query(query) ? errSecSuccess : errSecParam; }

int main(int argc, char **argv) {
    if (argc != 3 || strcmp(argv[1], "--provider-keychain") != 0) return 1;
    char input[8193];
    size_t bytes = fread(input, 1, sizeof(input) - 1, stdin);
    input[bytes] = '\0';
    char *result = fulcrum_provider_keychain(argv[2], input);
    if (!result) return 1;
    fputs(result, stdout);
    fulcrum_free_setup_string(result);
    return 0;
}
