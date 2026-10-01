import { describe, it, expect } from 'vitest';
import { config, kdf, passwordInput, subjectInput, uuid } from './auth.ts';
import { randomBytes } from 'node:crypto';
describe('auth configuration and password adapter',()=>{
 it('fails closed for local external bind and non-HTTPS network origins',()=>{
  for(const bindHost of ['0.0.0.0','localhost','::']) expect(()=>config({mode:'local',origin:'http://127.0.0.1:3000',bindHost})).toThrow();
  expect(()=>config({mode:'network',origin:'http://example.test',bindHost:'0.0.0.0'})).toThrow();
  expect(()=>config({mode:'local',origin:'http://evil.test',bindHost:'127.0.0.1'})).toThrow();
 });
 it('requires exact origins and sets HTTPS host cookie flags',()=>{
  expect(()=>config({mode:'network',origin:'https://example.test/',bindHost:'0.0.0.0'})).toThrow();
  expect(config({mode:'network',origin:'https://example.test',bindHost:'127.0.0.1'})).toMatchObject({secure:true,cookieName:'__Host-exhibitos_session'});
  expect(config({mode:'local',origin:'http://[::1]:3000',bindHost:'::1'}).secure).toBe(false);
 });
 it('rejects bounded invalid password, subject and UUID inputs',()=>{
  for(const value of ['', 'short', 'x'.repeat(1025), undefined]) expect(()=>passwordInput(value)).toThrow();
  expect(()=>subjectInput('bad subject')).toThrow();expect(()=>uuid('bad')).toThrow();
 });
 it('derives and verifies 32-byte Argon2id keys without exposing them',async()=>{
  const salt=randomBytes(16);const first=await kdf('synthetic-password-only',salt);
  expect(first.length).toBe(32);expect(await kdf('synthetic-password-only',salt)).toEqual(first);
  expect(await kdf('synthetic-password-wrong',salt)).not.toEqual(first);
 });
});
