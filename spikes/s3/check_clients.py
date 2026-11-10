import asyncio
from types import SimpleNamespace
import httpx2
from graphiti_adapter import local_clients
from graphiti_core.telemetry import is_telemetry_enabled


async def main():
    async def deny(request):
        raise AssertionError('IMPORT_CHECK_MUST_NOT_REQUEST_INFERENCE')
    async with httpx2.AsyncClient(trust_env=False, event_hooks={'request': [deny]}) as client:
        args = SimpleNamespace(endpoint='http://127.0.0.1:11435/v1', model='synthetic-not-called',
            embedding_model='synthetic-not-called', embedding_dimensions=768)
        llm, embedder = local_clients(args, client)
        assert str(llm.client.base_url) == 'http://127.0.0.1:11435/v1/'
        assert llm.client is embedder.client
        assert not is_telemetry_enabled()
    print('Local clients constructed; no inference requested; telemetry disabled')


if __name__ == '__main__':
    asyncio.run(main())
