import type { APIRoute } from 'astro';
import { marker } from '../gen/marker.ts';

export const prerender = false;

export const GET: APIRoute = () => new Response(marker);
