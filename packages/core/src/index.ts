/**
 * sprite-fighter: folha de peças PNG → personagem articulado → cenas de luta 2D roteirizadas.
 * Sem dependências de runtime. Este é o player; o que é só de autoria (conferência detalhada do
 * roteiro, JSON Schema e docs dos comandos, API fluente, desenho de debug) fica em
 * `sprite-fighter/authoring`.
 */
export const VERSION = '0.1.1';

export * from './math.js';
export { PartGeometry, opaquePoints, type Box } from './geometry.js';
export { parseAtlas, type AtlasData, type AtlasPart, type Rect } from './atlas.js';
export { parseRig, solveRig, pickPivot } from './rig.js';
export type { RigSpec, BoneSpec, CapSpec, ChainSpec, PointSpec, SolvedRig, SolvedBone, SolvedCap } from './rig.js';
export { Skeleton, type BonePose, type RootTransform, type DrawItem } from './skeleton.js';
export { Character, type AtlasImage, type SkinKind, type PoseTransition, type SkinChange, type PoseIndex, type PoseLoaders } from './character.js';
export { CanvasRenderer, createSprite, type Camera, type DrawOptions, type Drawable, type Sprite } from './renderer.js';
export { DataError } from './validate.js';
export { EASINGS, EASE_NAMES, ease, type EaseName, type EaseFn } from './easing.js';
export { FixedClock, runLoop, SIM_HZ, SIM_DT, AUTHOR_FPS, framesToSeconds } from './loop.js';
export { parseClip, checkClip, sampleKeys, sampleBone, sampleRoot, sampleSlot, eventsBetween, clipFrame } from './clip.js';
export type { ClipData, Key, BoneSample, RootSample } from './clip.js';
export { Animator, DEFAULT_FADE, type PlayOptions, type ClipEvent, type LayerState } from './animator.js';
export { SpringChain, SquashStretch, solveTwoBone, aimTwoBone, lookAt, hover, rotateWorld, type SpringOptions } from './procedural.js';
export { Actor, TRANSITION_FRAMES, SMEAR_FRAMES, type ActorOptions, type AfterimageOptions } from './actor.js';
export { parsePose, type PoseData, type PoseBone } from './pose.js';
export { parseSkin, skinToRig, restMatrices, SKIN_BODY, type SkinSpec, type SkinBoneSpec } from './skin.js';
export { buildSkinMesh, computeWeights, delaunay, type SkinMesh, type MeshInput } from './mesh.js';
export { deformLBS, skinMatrices } from './deform.js';
export { GLSkinRenderer, MAX_SKIN_BONES } from './gl-skin.js';
export { buildImagePose, assembleImagePose, boneSignature, type ImagePose } from './image-pose.js';
export { createRng } from './rng.js';
export { defaultTransition } from './character.js';
export { provisionalPose, buildVariant, silhouetteDiff, VARIANT_SILHOUETTE_WARN, type ProvisionalSpec } from './image-pose.js';
export { capsuleHit, capsuleBoxHit, circle, closestOnSegment, closestSegmentSegment, type Capsule, type Contact, type Box as CollisionBox } from './collision.js';
export { estimateHurtRadii, hurtboxesOf } from './hurtbox.js';
export { Route } from './route.js';
export { MoveTo, Impulse, Hover, Fall, dash, knockback, type Motion, type Body } from './motion.js';
export { parseMove, parseMoves, checkMovePoses, MoveRunner } from './move.js';
export type { MoveData, PhaseSpec, HitboxSpec, SpawnSpec, OnHitSpec, MotionSpec, FxSpec, PhaseEnter } from './move.js';
export { registerAction, getAction, hasAction, actionNames, type ActionContext, type ActionFn, type FxApi, type CameraApi } from './actions.js';
export { World, Fighter, FX_PRESETS, type Projectile, type Prop, type HitEvent, type FxTarget } from './world.js';
export { Effects, type SparkOptions, type ImpactOptions, type SpeedLineOptions } from './fx.js';
export { CameraRig, smoothNoise, union, SHAKE_MAX, TRAUMA_DECAY, type AutoOptions, type Rect as CameraRect } from './camera.js';
export { drawParallax, type ParallaxLayer } from './parallax.js';
export { drawProjectiles } from './fight-draw.js';
export { parseManifest, VARIANT_KINDS, type CharacterManifest, type CharacterInfo, type PoseMeta, type VariantMeta, type VariantKind } from './manifest.js';
export { registerProp, getPropType, propTypes, drawProps, type PropType } from './props.js';
export { parseScript, eachStep, COMMANDS, EVENTS, TRANSITIONS } from './script.js';
export type { Script, ScriptStep, CastSpec, CommandSpec, ParamSpec, ParamKind } from './script.js';
export { Director, FX_TYPES, type CastMember, type DirectorOptions, type Bubble, type StepEvent } from './director.js';
export { Scene, type SceneOptions, type DebugDraw } from './scene.js';
