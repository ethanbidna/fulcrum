import asyncio
import json
import logging
from pathlib import Path
import platform
import tempfile
from types import SimpleNamespace
import sys

from run import write_report, stop_owned_children


async def probe(report):
    import httpx2 as httpx
    import psutil
    from graphiti_adapter import GraphitiAdapter
    adapter = None
    prior = {child.pid for child in psutil.Process().children(recursive=True)}

    async def deny(request):
        raise RuntimeError('STORE_PROBE_FORBIDS_INFERENCE')

    try:
        with tempfile.TemporaryDirectory(prefix='fulcrum-s3-store-') as directory:
            async with httpx.AsyncClient(trust_env=False, event_hooks={'request': [deny]}) as client:
                args = SimpleNamespace(endpoint='http://127.0.0.1:11435/v1',
                    model='synthetic-not-called', embedding_model='synthetic-not-called',
                    embedding_dimensions=768)
                try:
                    adapter = GraphitiAdapter(Path(directory), args, client)
                    await asyncio.wait_for(adapter.initialize(), 20)
                    report['storeReady'] = True
                finally:
                    if adapter:
                        await adapter.close()
    except Exception as error:
        report['storeReady'] = False
        report['failureClass'] = type(error).__name__
        if isinstance(error, OSError):
            report['errorNumber'] = error.errno
    finally:
        stop_owned_children(prior)


def main():
    logging.disable(logging.CRITICAL)
    report = {'schemaVersion': 1, 'architecture': platform.machine(), 'storeReady': False,
              'inferenceRequested': False, 'hardwareAcceptance': False}
    asyncio.run(probe(report))
    write_report(Path(sys.argv[1]), report)
    print('Store ready:', report['storeReady'])
    return 0 if report['storeReady'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
