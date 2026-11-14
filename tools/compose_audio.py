"""Render the game's original, deterministic arcade score and feedback cues.

NumPy and SoundFile are needed only to regenerate the committed WAV and FLAC files.
"""
from pathlib import Path
import wave

import numpy as np

RATE = 22050
DESTINATION = Path(__file__).resolve().parents[1] / 'frontend' / 'assets' / '13_audio'


def save(name, samples):
    DESTINATION.mkdir(exist_ok=True)
    samples = np.tanh(samples * 1.32)
    pcm = np.rint(np.clip(samples, -.98, .98) * 32767).astype('<i2')
    with wave.open(str(DESTINATION / f'{name}.wav'), 'wb') as out:
        out.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        out.writeframes(pcm.tobytes())


def frequency(note):
    return 440 * 2 ** ((note - 69) / 12)


def instrument(note, duration, kind):
    t = np.arange(round(RATE * duration)) / RATE
    attack = np.minimum(t / .009, 1)
    release = np.minimum((duration - t) / .045, 1)
    pitch = frequency(note)
    phase = 2 * np.pi * pitch * t
    if kind == 'mallet':
        tone = np.sin(phase) + .26 * np.sin(phase * 2) + .15 * np.sin(phase * 3)
        tone += .21 * np.sin(phase * 4.02) * np.exp(-t * 19)
        envelope = np.exp(-t * 4.6)
    elif kind == 'reed':
        vibrato = .24 * np.sin(2 * np.pi * 5.3 * t) * np.minimum(t / .21, 1)
        p = phase + vibrato
        tone = .85 * np.sin(p) + .15 * np.sin(p * 2) + .24 * np.sin(p * 3) + .07 * np.sin(p * 5)
        attack = np.minimum(t / .02, 1)
        envelope = np.exp(-t * 2.25) * (.93 + .07 * np.sin(t * 28))
    elif kind == 'flute':
        p = phase + .19 * np.sin(2 * np.pi * 5.9 * t) * np.minimum(t / .17, 1)
        tone = np.sin(p) + .17 * np.sin(p * 2) + .07 * np.sin(p * 4) * np.exp(-t * 8)
        attack = np.minimum(t / .031, 1)
        envelope = np.exp(-t * 1.95)
    elif kind == 'pizz':
        tone = np.sin(phase) + .51 * np.sin(phase * 2) + .22 * np.sin(phase * 3) + .11 * np.sin(phase * 6)
        envelope = np.exp(-t * 10)
    elif kind == 'pluck':
        tone = np.sin(phase) + .22 * np.sin(phase * 2) + .15 * np.sin(phase * 4) * np.exp(-t * 17)
        envelope = np.exp(-t * 8.4)
    elif kind == 'pad':
        tone = .44 * (np.sin(phase * .997) + np.sin(phase * 1.003)) + .18 * np.sin(phase * 2)
        attack = np.minimum(t / .11, 1)
        release = np.minimum((duration - t) / .21, 1)
        envelope = 1 - np.minimum(t / duration, 1) * .26
    elif kind == 'bell':
        tone = np.sin(phase) + .27 * np.sin(phase * 2.02) + .12 * np.sin(phase * 3.96)
        envelope = np.exp(-t * 7)
    elif kind == 'bass':
        tone = .82 * np.sin(phase) + .39 * np.sin(phase * 2) + .16 * np.sin(phase * 3)
        envelope = np.exp(-t * 8.2)
    else:
        tone = .48 * np.sin(phase) + .23 * np.sin(phase * 2) + .1 * np.sin(phase * 3)
        envelope = np.exp(-t * 9)
    return tone * envelope * attack * release


def score(name, tempo, chords, melody, style):
    beat = 60 / tempo
    length = round(len(chords) * 4 * beat * RATE)
    output = np.zeros((length, 2))
    rng = np.random.default_rng(31)
    village = style == 'village'
    winter = style == 'winter'
    swing = .068 if village else .12

    def mix(at, audio, gain, pan=0.0):
        index = round(RATE * beat * at)
        indexes = (np.arange(len(audio)) + index) % length
        # Keep a strong mono center even when the little countermelodies spread out.
        output[indexes] += (audio * gain)[:, None] * np.sqrt(np.array((1 - pan, 1 + pan)))

    def note(at, pitch, duration, kind, gain, pan=0.0):
        sound = instrument(pitch, duration * beat, kind)
        mix(at, sound, gain, pan)
        if kind in ('reed', 'bell', 'mallet', 'flute'):
            mix(at + .236, sound, gain * .10, -.44)
            mix(at + .389, sound, gain * .067, .48)

    def drum(at, kind, gain, pan=0):
        t = np.arange(round(RATE * (.2 if kind == 'shaker' else .14))) / RATE
        noise = rng.normal(0, 1, len(t))
        if kind == 'kick':
            phase = 2 * np.pi * (55 * t + 65 * (1 - np.exp(-t * 42)) / 42)
            sound = (np.sin(phase) + .18 * np.sin(phase * 2)) * np.exp(-t * 27)
        elif kind == 'wood':
            sound = (np.sin(2 * np.pi * 906 * t) + .32 * np.sin(2 * np.pi * 1850 * t)) * np.exp(-t * 57)
        elif kind == 'shaker':
            sound = np.r_[0, np.diff(noise)] * np.exp(-t * 34) * .30
        else:
            sound = (.27 * noise + .45 * np.sin(2 * np.pi * 182 * t) + .12 * np.sin(2 * np.pi * 256 * t)) * np.exp(-t * 42)
        mix(at, sound * np.minimum(t / .004, 1), gain, pan)

    for bar, (bass, chord) in enumerate(chords):
        root, third, fifth = chord
        base = bar * 4
        bridge = 8 <= bar < 16
        refrain = bar >= 16
        stabs = [(.5, root), (1.5, fifth), (2.5, third), (3.5, fifth)]
        bassline = [(0, bass), (1.5, bass + 12), (2, bass + 7), (3.5, bass + 12)]
        if bridge:
            stabs = [(0, root), (1, fifth), (2, third + 12), (3, fifth)]
            bassline = [(0, bass), (2.5, bass + 7), (3.5, bass + 12)]
        for at, pitch in bassline:
            note(base + at, pitch, .62 if bridge else .53, 'bass', .135)
        for offset, pitch in stabs:
            at = base + offset + swing * (offset % 1 > 0)
            note(at, pitch, .57, 'pizz', .066, -.39)
            if refrain:
                note(at + .043, pitch + 12, .47, 'pluck', .032, .37)
        for pitch in chord:
            note(base, pitch, 4.1, 'pad', .024 if bridge else .015, .32 if pitch == third else -.18)

        for slot, pitch in enumerate(melody[bar]):
            if not pitch:
                if slot in (3, 5, 7):
                    note(base + slot / 2 + swing, fifth + 12 - 5 * (slot == 5), .34,
                         'bell' if winter else 'flute', .055, .36)
                continue
            at = base + slot / 2 + swing * (slot % 2)
            sustain = slot == 7 or not melody[bar][slot + 1]
            voice = 'flute' if bridge else 'reed' if village or sustain else 'mallet'
            note(at, pitch, .82 if sustain else .52, voice, .17 if slot % 2 == 0 else .128, -.08)
            if refrain and slot in (0, 4, 6):
                note(at, pitch - 12, .52, 'mallet', .073, -.24)
            if winter and slot in (0, 3, 6):
                note(at, pitch + 12, .55, 'bell', .033, .35)

        for at in ((0, 1.75, 2.5, 3.5) if village and not bridge else (0, 2)):
            drum(base + at, 'kick', .14 if village else .095)
        for at in (1, 3):
            drum(base + at, 'snare' if village else 'wood', .094 if refrain else .069, -.19)
        for at in (.5, 1.5, 2.5, 3.5):
            drum(base + at + swing, 'shaker', .048, .29 if at < 2 else -.29)
        if bar % 4 == 3:
            drum(base + 3.26, 'wood', .064, .24)
            drum(base + 3.76, 'wood', .047, -.24)
            note(base + 3.34, fifth + 12, .64, 'bell', .057, .37)

    DESTINATION.mkdir(exist_ok=True)
    # FLAC stores the exact loop length, including the short ambience that wraps around.
    from soundfile import write
    output = np.rint(np.tanh(output * 1.45) * 4096) / 4096
    write(DESTINATION / f'{name}.flac', output, RATE, subtype='PCM_16')


LOBBY_CHORDS = [
    (48, [60, 64, 67]), (45, [60, 64, 69]), (41, [60, 65, 69]), (43, [59, 62, 67]),
    (48, [60, 64, 67]), (40, [59, 64, 67]), (41, [60, 65, 69]), (43, [59, 62, 67]),
    (45, [60, 64, 69]), (40, [59, 64, 67]), (41, [60, 65, 69]), (48, [60, 64, 67]),
    (50, [60, 62, 65]), (41, [60, 65, 69]), (43, [59, 62, 67]), (48, [60, 64, 67]),
]
LOBBY_TUNE = [
    [72, 0, 76, 79, 0, 76, 74, 72], [69, 72, 76, 0, 81, 79, 76, 0],
    [77, 0, 76, 72, 69, 72, 77, 0], [74, 71, 67, 0, 74, 77, 79, 0],
    [84, 0, 79, 76, 72, 0, 76, 79], [83, 79, 76, 0, 71, 74, 76, 0],
    [81, 0, 77, 72, 69, 72, 77, 76], [74, 0, 71, 74, 79, 77, 74, 0],
    [69, 0, 72, 0, 76, 0, 79, 0], [76, 0, 71, 0, 67, 0, 71, 0],
    [72, 0, 77, 0, 81, 0, 77, 0], [76, 0, 79, 0, 84, 0, 79, 0],
    [74, 77, 81, 0, 77, 74, 72, 0], [69, 72, 77, 0, 81, 77, 76, 0],
    [74, 0, 79, 77, 74, 71, 67, 0], [72, 0, 76, 79, 84, 0, 79, 0],
]
VILLAGE_CHORDS = [
    (46, [58, 62, 65]), (41, [57, 60, 65]), (43, [58, 62, 67]), (39, [55, 58, 63]),
    (46, [58, 62, 65]), (38, [57, 62, 66]), (39, [55, 58, 63]), (41, [57, 60, 65]),
    (43, [58, 62, 67]), (39, [55, 58, 63]), (46, [58, 62, 65]), (41, [57, 60, 65]),
    (39, [55, 58, 63]), (48, [55, 60, 63]), (41, [57, 60, 65]), (46, [58, 62, 65]),
]
VILLAGE_TUNE = [
    [77, 77, 0, 74, 70, 0, 74, 77], [72, 0, 69, 72, 77, 0, 76, 72],
    [74, 79, 77, 0, 74, 70, 74, 0], [75, 0, 79, 75, 70, 0, 67, 70],
    [82, 0, 77, 74, 70, 74, 77, 0], [78, 0, 81, 78, 74, 0, 69, 74],
    [75, 75, 0, 79, 82, 79, 75, 0], [77, 72, 69, 0, 72, 76, 77, 0],
    [74, 0, 70, 0, 67, 74, 0, 79], [75, 0, 72, 0, 70, 75, 0, 79],
    [77, 0, 74, 0, 70, 77, 0, 82], [81, 0, 77, 0, 72, 0, 69, 0],
    [79, 77, 75, 0, 77, 0, 79, 82], [84, 0, 79, 75, 72, 0, 74, 75],
    [77, 81, 77, 76, 72, 69, 0, 72], [70, 0, 74, 77, 82, 0, 77, 0],
]
WINTER_CHORDS = [
    (45, [60, 64, 69]), (41, [57, 60, 65]), (48, [60, 64, 67]), (43, [59, 62, 67]),
    (45, [60, 64, 69]), (46, [58, 62, 65]), (41, [57, 60, 65]), (40, [59, 64, 68]),
    (50, [57, 62, 65]), (43, [59, 62, 67]), (48, [60, 64, 67]), (45, [60, 64, 69]),
    (41, [57, 60, 65]), (50, [57, 62, 65]), (40, [59, 64, 68]), (45, [60, 64, 69]),
]
WINTER_TUNE = [
    [81, 0, 76, 72, 76, 0, 81, 84], [84, 81, 77, 0, 72, 0, 77, 81],
    [79, 0, 76, 79, 84, 0, 79, 76], [74, 79, 83, 0, 81, 79, 74, 0],
    [76, 81, 0, 84, 88, 0, 84, 81], [82, 0, 77, 74, 77, 0, 82, 86],
    [84, 81, 77, 0, 81, 84, 81, 0], [80, 76, 71, 0, 76, 0, 80, 0],
    [77, 0, 74, 0, 69, 0, 77, 81], [79, 0, 74, 0, 71, 0, 79, 83],
    [84, 0, 79, 0, 76, 0, 79, 84], [81, 0, 76, 0, 72, 0, 76, 81],
    [84, 81, 77, 0, 84, 81, 77, 0], [86, 81, 77, 0, 74, 77, 81, 0],
    [80, 83, 80, 76, 71, 76, 80, 0], [81, 0, 76, 72, 81, 0, 76, 0],
]


def chirp(duration, start, end, gain=1):
    t = np.arange(round(RATE * duration)) / RATE
    phase = 2 * np.pi * (start * t + (end - start) * t * t / (2 * duration))
    env = np.minimum(t / .007, 1) * np.minimum((duration - t) / .03, 1) * np.exp(-.6 * t / duration)
    return gain * env * (np.sin(phase) + .21 * np.sin(phase * 2))


def cue(name, duration, parts, splash=0):
    out = np.zeros(round(RATE * duration))
    for at, length, start, end, gain in parts:
        begin = round(at * RATE)
        samples = chirp(length, start, end, gain)
        out[begin:begin + len(samples)] += samples
    if splash:
        noise = np.random.default_rng(123).normal(0, 1, len(out))
        filtered = np.convolve(noise, np.ones(6) / 6, mode='same')
        time = np.arange(len(out)) / RATE
        out += filtered * splash * np.exp(-time * 19) * np.minimum(time / .005, 1)
    save(name, out)


def jingle(name, notes):
    output = np.zeros(round(RATE * 1.45))
    for at, pitch, voice, gain in notes:
        start = round(at * RATE)
        sound = instrument(pitch, .46, voice)
        output[start:start + len(sound)] += gain * sound
    save(name, output)


if __name__ == '__main__':
    for name, tempo, chords, melody, style in (
        ('bubble_plaza', 114, LOBBY_CHORDS, LOBBY_TUNE, 'lobby'),
        ('village_dash', 136, VILLAGE_CHORDS, VILLAGE_TUNE, 'village'),
        ('frost_hop', 126, WINTER_CHORDS, WINTER_TUNE, 'winter'),
    ):
        score(name, tempo, chords + chords[:8], melody + melody[:8], style)
    cue('place', .19, [(0,.12,860,316,.38),(.054,.13,590,975,.19)])
    cue('throw', .29, [(0,.19,410,1190,.29),(.12,.15,940,410,.25)], .09)
    cue('splash', .35, [(0,.17,280,97,.29),(.041,.118,910,447,.16),(.152,.15,776,503,.13)], .55)
    cue('prize', .31, [(0,.12,740,905,.23),(.069,.13,997,1203,.24),(.15,.15,1480,1290,.20)])
    cue('bubble', .42, [(0,.18,580,1040,.22),(.09,.14,790,479,.26),(.235,.177,430,785,.19)], .05)
    cue('rescue', .37, [(0,.14,540,715,.25),(.095,.15,820,1060,.26),(.21,.15,1140,1510,.17)])
    cue('pop', .24, [(0,.15,842,225,.33),(.05,.175,390,235,.15)], .18)
    cue('go', .34, [(0,.14,685,900,.25),(.105,.218,1020,1430,.23)])
    cue('step', .09, [(0,.079,248,139,.22)], .055)
    cue('cheer', .48, [(0,.145,565,960,.21),(.10,.17,800,1120,.23),(.23,.23,1240,1360,.19)])
    cue('kick', .23, [(0,.10,342,142,.34),(.04,.178,560,340,.21)], .12)
    jingle('win', [(0,72,'mallet',.25),(.12,76,'mallet',.22),(.24,79,'mallet',.22),(.36,84,'bell',.24),
                   (.52,79,'reed',.15),(.59,84,'reed',.14),(.62,76,'bell',.19),(.75,88,'bell',.15),(.92,84,'bell',.12)])
    jingle('loss', [(0,77,'mallet',.21),(.15,76,'mallet',.18),(.32,72,'reed',.14),(.48,69,'mallet',.15),
                    (.64,65,'bell',.14),(.77,72,'bell',.14),(.91,77,'bell',.11)])
