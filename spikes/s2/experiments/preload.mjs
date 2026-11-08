import { installInferenceTransport } from './transport.mjs';

installInferenceTransport({ port: process.env.FULCRUM_INFERENCE_PORT });
