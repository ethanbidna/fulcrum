import argparse
import asyncio
from collections import Counter
from importlib.metadata import version
import json
import logging
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import time

from metrics import digest_bytes, score, validate_endpoint, validate_request_url

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_SECONDS = 0.1


def native(arguments):
    result = subprocess.run(['node', str(ROOT / 'spikes/s3/native.mjs'), *arguments],
                            capture_output=True, check=True, cwd=ROOT)
    return result.stdout


def parser():
    result = argparse.ArgumentParser(description='Synthetic local-only native/Graphiti comparison')
    result.add_argument('--output', type=Path, required=True)
    result.add_argument('--native-only', action='store_true')
    result.add_argument('--endpoint', default='http://127.0.0.1:11435/v1')
    result.add_argument('--model')
    result.add_argument('--embedding-model')
    result.add_argument('--embedding-dimensions', type=int, default=768)
    result.add_argument('--ollama-pid', type=int)
    result.add_argument('--ack-experimental-store', action='store_true')
    return result


async def sample_resources(report, model_pid, done):
    import psutil
    current = psutil.Process()
    while not done.is_set():
        for field, parent in [('processTreePeakRssBytes', current),
                              ('ollamaTreePeakRssBytes', psutil.Process(model_pid))]:
            processes = [parent, *parent.children(recursive=True)]
            resident = 0
            for process in processes:
                try:
                    resident += process.memory_info().rss
                except psutil.Error:
                    continue
            report[field] = max(report.get(field, 0), resident)
        await asyncio.sleep(SAMPLE_SECONDS)


async def preflight(transport, args):
    base = args.endpoint.removesuffix('/v1')
    response = await transport.get(base + '/api/tags')
    response.raise_for_status()
    installed = response.json()['models']
    models = {}
    for requested in [args.model, args.embedding_model]:
        found = next((item for item in installed if item['name'] in [requested, requested + ':latest']), None)
        if not found or not found.get('digest'):
            raise ValueError('EXPLICIT_INSTALLED_MODEL_REQUIRED')
        models[requested] = found['digest']
    response = await transport.get(base + '/api/version')
    response.raise_for_status()
    return {'ollamaVersion': response.json()['version'], 'modelDigests': models}


async def trial(fixture, args, directory, transport, counters, phase):
    from graphiti_adapter import GraphitiAdapter
    result = {'implementation': 'graphiti-falkordblite', 'episodeCount': len(fixture['episodes'])}
    adapter = None
    start = time.perf_counter()
    before = counters.copy()
    try:
        adapter = GraphitiAdapter(directory, args, transport)
        await adapter.initialize()
        result['setupMs'] = (time.perf_counter() - start) * 1000
        start = time.perf_counter()
        for position, episode in enumerate(fixture['episodes']):
            await adapter.ingest(episode, position)
        result['ingestMs'] = (time.perf_counter() - start) * 1000
        result['episodesPerMinute'] = len(fixture['episodes']) * 60000 / result['ingestMs']
        result['ingestLlmRequests'] = counters['chat'] - before['chat']
        result['llmCallsPerEpisode'] = result['ingestLlmRequests'] / len(fixture['episodes'])
        start = time.perf_counter()
        predictions = [await adapter.resolve(mention) for mention in fixture['mentions']]
        result['queryMs'] = (time.perf_counter() - start) * 1000
        result['quality'] = score(fixture['expected'], predictions)
        result['totalLlmRequests'] = counters['chat'] - before['chat']
        result['embeddingRequests'] = counters['embeddings'] - before['embeddings']
        result['phase'] = phase
        return result
    finally:
        if adapter:
            await adapter.close()


async def graphiti_report(fixture, args, report):
    import httpx2 as httpx
    import psutil
    process = psutil.Process(args.ollama_pid)
    if process.uids().real != os.getuid() or 'ollama' not in process.name().lower():
        raise ValueError('OWNED_OLLAMA_PROCESS_REQUIRED')
    counters = Counter()

    async def guard(request):
        validate_request_url(request.url, args.endpoint)
        if request.url.path.endswith('/chat/completions'):
            counters['chat'] += 1
        if request.url.path.endswith('/embeddings'):
            counters['embeddings'] += 1

    prior_children = {child.pid for child in psutil.Process().children(recursive=True)}
    done = asyncio.Event()
    sampler = asyncio.create_task(sample_resources(report, args.ollama_pid, done))
    try:
        async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=600,
                                     event_hooks={'request': [guard]}) as transport:
            report.update(await preflight(transport, args))
            with tempfile.TemporaryDirectory(prefix='fulcrum-s3-') as temporary:
                first, second = Path(temporary) / 'first', Path(temporary) / 'rebuild'
                first.mkdir(mode=0o700)
                second.mkdir(mode=0o700)
                report['graphiti'] = await trial(fixture, args, first, transport, counters, 'initial')
                report['rebuild'] = await trial(fixture, args, second, transport, counters, 'fresh-index-rebuild')
                report['rebuild']['rebuildMs'] = report['rebuild']['setupMs'] + report['rebuild']['ingestMs']
    finally:
        done.set()
        try:
            await sampler
        finally:
            report['networkRequests'] = dict(counters)
            stop_owned_children(prior_children)


def stop_owned_children(prior):
    import psutil
    for child in psutil.Process().children(recursive=True):
        if child.pid in prior:
            continue
        try:
            child.terminate()
            child.wait(timeout=5)
        except psutil.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)
        except psutil.Error:
            pass


def write_report(output, report):
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')


def main():
    args = parser().parse_args()
    args.endpoint = validate_endpoint(args.endpoint)
    if args.output.exists():
        raise ValueError('CHOOSE_A_NEW_REPORT_FILE')
    if not args.native_only and (not args.ack_experimental_store or not args.model
            or not args.embedding_model or not args.ollama_pid or not 1 <= args.embedding_dimensions <= 4096):
        raise ValueError('EXPLICIT_MODELS_PROCESS_AND_STORE_ACK_REQUIRED')
    logging.disable(logging.CRITICAL)
    fixture_bytes = native(['--fixture'])
    fixture = json.loads(fixture_bytes)
    baseline = json.loads(native([]))
    baseline['quality'] = score(fixture['expected'], baseline.pop('resolutions'))
    report = {'schemaVersion': 1, 'status': 'completed', 'hardwareAcceptance': False,
              'fixtureSha256': digest_bytes(fixture_bytes), 'architecture': platform.machine(),
              'pythonVersion': platform.python_version(), 'native': baseline,
              'graphitiMeasured': False}
    try:
        if not args.native_only:
            report['packages'] = {name: version(name) for name in ['graphiti-core', 'falkordblite', 'falkordb', 'redis']}
            asyncio.run(graphiti_report(fixture, args, report))
            report['graphitiMeasured'] = True
    except Exception as error:
        report['status'] = 'failed'
        report['failureClass'] = type(error).__name__
    write_report(args.output, report)
    print(f"Report {report['status']}; Graphiti measured: {report['graphitiMeasured']}")
    return 0 if report['status'] == 'completed' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'Spike did not start: {type(error).__name__}')
        raise SystemExit(1)
