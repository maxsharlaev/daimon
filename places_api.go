package main

import (
	"errors"
	"sort"
	"time"

	"daimon/internal/storage"
)

type PlaceDTO struct {
	ID        string `json:"id"`
	ProfileID string `json:"profileId"`
	Name      string `json:"name"`
	RemotePath string `json:"remotePath"`
	Order     int    `json:"order"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type UpsertPlaceRequest struct {
	ID         string `json:"id"`
	ProfileID  string `json:"profileId"`
	Name       string `json:"name"`
	RemotePath string `json:"remotePath"`
	Order      int    `json:"order"`
}

func (a *App) ListPlaces(profileId string) ([]PlaceDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("app not ready")
	}
	if profileId == "" {
		return nil, errors.New("profileId required")
	}
	var rows []storage.Place
	if err := a.db.DB.Find(&rows, "profile_id = ?", profileId).Error; err != nil {
		return nil, err
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Order != rows[j].Order {
			return rows[i].Order < rows[j].Order
		}
		return rows[i].UpdatedAt.After(rows[j].UpdatedAt)
	})
	out := make([]PlaceDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, PlaceDTO{
			ID:         r.ID,
			ProfileID:  r.ProfileID,
			Name:       r.Name,
			RemotePath: r.RemotePath,
			Order:      r.Order,
			CreatedAt:  r.CreatedAt.Format(time.RFC3339Nano),
			UpdatedAt:  r.UpdatedAt.Format(time.RFC3339Nano),
		})
	}
	return out, nil
}

func (a *App) UpsertPlace(req UpsertPlaceRequest) (PlaceDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return PlaceDTO{}, errors.New("app not ready")
	}
	if req.ProfileID == "" {
		return PlaceDTO{}, errors.New("profileId required")
	}
	if req.RemotePath == "" {
		return PlaceDTO{}, errors.New("remotePath required")
	}

	var p storage.Place
	if req.ID != "" {
		_ = a.db.DB.First(&p, "id = ?", req.ID).Error
	}
	p.ID = req.ID
	p.ProfileID = req.ProfileID
	p.Name = req.Name
	p.RemotePath = req.RemotePath
	p.Order = req.Order

	if err := a.db.DB.Save(&p).Error; err != nil {
		return PlaceDTO{}, err
	}
	return PlaceDTO{
		ID:         p.ID,
		ProfileID:  p.ProfileID,
		Name:       p.Name,
		RemotePath: p.RemotePath,
		Order:      p.Order,
		CreatedAt:  p.CreatedAt.Format(time.RFC3339Nano),
		UpdatedAt:  p.UpdatedAt.Format(time.RFC3339Nano),
	}, nil
}

func (a *App) DeletePlace(id string) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("app not ready")
	}
	if id == "" {
		return errors.New("id required")
	}
	return a.db.DB.Delete(&storage.Place{}, "id = ?", id).Error
}

