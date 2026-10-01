-- AIWaves intro: the edit and post-processing in DaVinci Resolve (Lua: built into Resolve, no
-- Python needed). Workspace > Scripts > AIWaves Intro Edit (Lua)
-- Project "AIWaves Intro": the Blender frames + the sound design on one timeline; a filmic grade;
-- a Fusion comp (soft glow -> film grain -> vignette); renders aiwaves_intro_resolve.mp4; saves.

local HERE = [[C:\Users\chrom\Desktop\aiwaves\media\intro]]
local LOG = HERE .. [[\resolve_edit.log]]
local f0 = io.open(LOG, "w"); if f0 then f0:close() end

local function log(msg)
  print(msg)
  local f = io.open(LOG, "a")
  if f then f:write(os.date("%H:%M:%S ") .. tostring(msg) .. "\n"); f:close() end
end

local resolve = (Resolve and Resolve()) or bmd.scriptapp("Resolve")
if not resolve then log("ERROR: no Resolve object"); return end
log("connected: " .. resolve:GetProductName() .. " " .. resolve:GetVersionString())

local pm = resolve:GetProjectManager()
local proj = pm:LoadProject("AIWaves Intro") or pm:CreateProject("AIWaves Intro")
if not proj then log("ERROR: cannot create or load project 'AIWaves Intro'"); return end
proj:SetSetting("timelineFrameRate", "30")
proj:SetSetting("timelineResolutionWidth", "1920")
proj:SetSetting("timelineResolutionHeight", "1080")
proj:SetSetting("timelinePlaybackFrameRate", "30")

local pool = proj:GetMediaPool()
local root = pool:GetRootFolder()
local old = root:GetClipList()
if old and #old > 0 then pool:DeleteClips(old) end            -- a rerun starts clean
local seq = pool:ImportMedia({ { FilePath = HERE .. [[\frames_1080\f_%04d.png]], StartIndex = 1, EndIndex = 300 } })
local aud = pool:ImportMedia({ HERE .. [[\intro_sfx.wav]] })
if not seq or not seq[1] or not aud or not aud[1] then log("ERROR: import failed (frames/audio)"); return end
log("imported: frames + sound design")

for i = proj:GetTimelineCount(), 1, -1 do
  local t = proj:GetTimelineByIndex(i)
  if t and t:GetName() == "AIWaves Intro" then pool:DeleteTimelines({ t }) end
end
local tl = pool:CreateEmptyTimeline("AIWaves Intro")
proj:SetCurrentTimeline(tl)
pool:AppendToTimeline({ { mediaPoolItem = seq[1], trackIndex = 1, mediaType = 1 } })
pool:AppendToTimeline({ { mediaPoolItem = aud[1], trackIndex = 1, mediaType = 2 } })
local item = tl:GetItemListInTrack("video", 1)[1]
log("timeline built: " .. (tl:GetEndFrame() - tl:GetStartFrame()) .. " frames")

-- grade: the same look as post.py: deeper contrast, a neutral white studio, cooler shadows
local ok = item:SetCDL({ NodeIndex = "1", Slope = "1.03 1.03 1.04", Offset = "-0.010 -0.008 -0.004",
                         Power = "1.06 1.06 1.05", Saturation = "1.06" })
log("grade (CDL): " .. tostring(ok))

-- post: soft glow -> film grain -> vignette
local comp = item:AddFusionComp()
if comp then
  local mi, mo = comp:FindTool("MediaIn1"), comp:FindTool("MediaOut1")
  local glow = comp:AddTool("SoftGlow", 1, 0)
  glow.Input = mi.Output
  glow.Threshold = 0.82
  glow.Gain = 0.5
  glow.XGlowSize = 18
  local grain = comp:AddTool("FilmGrain", 2, 0)
  grain.Input = glow.Output
  grain.Strength = 0.12
  local mask = comp:AddTool("EllipseMask", 3, 1)
  mask.Width = 1.25
  mask.Height = 1.25
  mask.SoftEdge = 0.45
  mask.Invert = 1
  local vig = comp:AddTool("BrightnessContrast", 3, 0)
  vig.Input = grain.Output
  vig.Gain = 0.86
  vig.EffectMask = mask.Mask
  mo.Input = vig.Output
  log("post (Fusion): soft glow, film grain, vignette")
else
  log("WARNING: no Fusion comp (post-processing skipped)")
end

proj:SetCurrentRenderFormatAndCodec("mp4", "H264")
proj:SetRenderSettings({ SelectAllFrames = true, TargetDir = HERE, CustomName = "aiwaves_intro_resolve",
                         ExportVideo = true, ExportAudio = true, FormatWidth = 1920, FormatHeight = 1080, FrameRate = "30" })
proj:DeleteAllRenderJobs()
local job = proj:AddRenderJob()
if not job then log("ERROR: could not add the render job"); return end
proj:StartRendering({ job })
local waited = 0
while proj:IsRenderingInProgress() and waited < 900 do bmd.wait(1); waited = waited + 1 end
local st = proj:GetRenderJobStatus(job)
log("render: " .. tostring(st and st.JobStatus) .. " " .. tostring(st and st.CompletionPercentage) .. "%")
pm:SaveProject()
log("DONE: " .. HERE .. [[\aiwaves_intro_resolve.mp4]])
